/**
 * Append-only JSONL audit log of paid calls.
 *
 * Used to populate SUBMISSION.md's "External Adoption" table — for every
 * successful pay+execute we record the payer wallet, workflow, timestamp,
 * settlement tx, and a redacted output snippet.
 *
 * Writers are async and best-effort; they never throw into the request path.
 */

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import { log } from "./util/log.js";

export interface AuditEntry {
  ts: string;
  workflowId: string;
  payer?: string;
  txHash?: string;
  network: string;
  outputPreview?: string;
}

export class AuditLog {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Best-effort append; logs and swallows errors so the request always returns. */
  async append(entry: AuditEntry): Promise<void> {
    try {
      await fs.mkdir(dirname(this.path), { recursive: true });
      await fs.appendFile(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (err: unknown) {
      log.warn("audit append failed", {
        path: this.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Read the last `limit` rows (newest first). Returns [] if the file is missing. */
  async tail(limit: number): Promise<AuditEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const tail = lines.slice(-limit).reverse();
    return tail.map(parseLine).filter((e): e is AuditEntry => e !== null);
  }
}

function parseLine(line: string): AuditEntry | null {
  try {
    return JSON.parse(line) as AuditEntry;
  } catch {
    return null;
  }
}

/** Truncate JSON outputs so the audit row stays small. */
export function previewOutput(value: unknown, maxChars = 280): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}
