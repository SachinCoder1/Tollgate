import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RegistryCorruptError } from "../src/errors.ts";
import { Registry, type StoredWorkflow } from "../src/registry.ts";

const sampleEntry = (id: string): StoredWorkflow => ({
  workflowId: id,
  price: "0.02",
  currency: "USDC",
  network: "base-sepolia",
  payTo: "0x1111111111111111111111111111111111111111",
  endpointUrl: `http://localhost:3030/run/${id}`,
  registeredAt: "2026-05-02T00:00:00.000Z",
  keeperhubApiKey: "kh_test_key",
});

let dir = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "keepertoll-registry-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Registry", () => {
  it("starts empty when the file does not exist", async () => {
    const r = new Registry(join(dir, "missing.json"));
    await r.load();
    expect(r.list()).toEqual([]);
    expect(r.size()).toBe(0);
  });

  it("upserts and persists atomically (round trip)", async () => {
    const path = join(dir, "registry.json");
    const r = new Registry(path);
    await r.load();
    await r.upsert(sampleEntry("wf_a"));
    await r.upsert(sampleEntry("wf_b"));

    const r2 = new Registry(path);
    await r2.load();
    expect(
      r2
        .list()
        .map((w) => w.workflowId)
        .sort(),
    ).toEqual(["wf_a", "wf_b"]);
    expect(r2.get("wf_a")?.price).toBe("0.02");
  });

  it("removes entries", async () => {
    const path = join(dir, "registry.json");
    const r = new Registry(path);
    await r.load();
    await r.upsert(sampleEntry("wf_a"));
    expect(await r.remove("wf_a")).toBe(true);
    expect(await r.remove("wf_a")).toBe(false);
    expect(r.size()).toBe(0);
  });

  it("rejects unsupported registry version (corrupt file)", async () => {
    const path = join(dir, "registry.json");
    await fs.writeFile(path, JSON.stringify({ version: 99, workflows: {} }));
    const r = new Registry(path);
    await expect(r.load()).rejects.toBeInstanceOf(RegistryCorruptError);
  });

  it("rejects malformed JSON (corrupt file)", async () => {
    const path = join(dir, "registry.json");
    await fs.writeFile(path, "{not json");
    const r = new Registry(path);
    await expect(r.load()).rejects.toBeInstanceOf(RegistryCorruptError);
  });

  it("writes file with mode 0600", async () => {
    const path = join(dir, "registry.json");
    const r = new Registry(path);
    await r.load();
    await r.upsert(sampleEntry("wf_a"));
    const stat = await fs.stat(path);
    // mask off type bits, compare permission bits
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
