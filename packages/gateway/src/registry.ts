/**
 * Atomic JSON-file registry for published workflows.
 *
 * Path is read from `GATEWAY_REGISTRY_PATH` (default `./.keepertoll/registry.json`).
 * Stores `kh_` API keys, so the file is created with mode 0600.
 *
 * Concurrency model: the gateway is the only writer. Reads are served from an
 * in-memory cache loaded at boot and invalidated on every write.
 */

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import { RegistryCorruptError } from "./errors.js";
import type { RegisteredWorkflow } from "./types.js";

export interface StoredWorkflow extends RegisteredWorkflow {
  /** Org-scoped KeeperHub API key. Never echoed in admin GET responses. */
  keeperhubApiKey: string;
}

interface RegistryFile {
  version: 1;
  workflows: Record<string, StoredWorkflow>;
}

const EMPTY: RegistryFile = { version: 1, workflows: {} };

export class Registry {
  readonly path: string;
  private cache: Map<string, StoredWorkflow> | null = null;

  constructor(path: string) {
    this.path = path;
  }

  /** Force-load from disk. Called once at server boot. */
  async load(): Promise<void> {
    const raw = await readOrEmpty(this.path);
    if (raw.version !== 1) {
      throw new RegistryCorruptError(
        `unsupported registry version ${String(raw.version)} at ${this.path}`,
      );
    }
    this.cache = new Map(Object.entries(raw.workflows));
  }

  list(): StoredWorkflow[] {
    return [...this.requireCache().values()];
  }

  get(workflowId: string): StoredWorkflow | undefined {
    return this.requireCache().get(workflowId);
  }

  async upsert(entry: StoredWorkflow): Promise<void> {
    const cache = this.requireCache();
    cache.set(entry.workflowId, entry);
    await this.flush();
  }

  async remove(workflowId: string): Promise<boolean> {
    const cache = this.requireCache();
    const had = cache.delete(workflowId);
    if (had) await this.flush();
    return had;
  }

  size(): number {
    return this.requireCache().size;
  }

  private requireCache(): Map<string, StoredWorkflow> {
    if (this.cache === null) {
      throw new Error("Registry not loaded; call load() first");
    }
    return this.cache;
  }

  private async flush(): Promise<void> {
    const cache = this.requireCache();
    const file: RegistryFile = {
      version: 1,
      workflows: Object.fromEntries(cache),
    };
    await writeAtomic(this.path, file);
  }
}

async function readOrEmpty(path: string): Promise<RegistryFile> {
  try {
    const text = await fs.readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err: unknown) {
      throw new RegistryCorruptError(`failed to parse JSON at ${path}`, {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      !("workflows" in parsed)
    ) {
      throw new RegistryCorruptError(`registry at ${path} missing version/workflows`);
    }
    return parsed as RegistryFile;
  } catch (err: unknown) {
    if (err instanceof RegistryCorruptError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw err;
  }
}

async function writeAtomic(path: string, file: RegistryFile): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  // mode 0600: file may contain kh_ API keys
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
}
