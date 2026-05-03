/**
 * End-to-end CLI tests against `run(argv)`. These exercise:
 *   - bare-form workflow id dispatches to publish
 *   - --help / --version exit zero with output
 *   - missing required flag exits non-zero
 *   - --dry-run does not call any server (no fetch is mocked, so a real call
 *     would crash)
 *   - publish with --dry-run --json emits a single JSON line
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/index.ts";

const ENV_KEYS = [
  "X402_PAY_TO",
  "KEEPERHUB_API_KEY",
  "KEEPERHUB_API_BASE",
  "GATEWAY_PUBLIC_URL",
  "GATEWAY_ADMIN_TOKEN",
] as const;
const snapshot = new Map<string, string | undefined>();

let stdoutChunks: string[] = [];
let stderrChunks: string[] = [];
let originalWrite: { stdout: typeof process.stdout.write; stderr: typeof process.stderr.write };

beforeEach(() => {
  for (const k of ENV_KEYS) {
    snapshot.set(k, process.env[k]);
    delete process.env[k];
  }
  stdoutChunks = [];
  stderrChunks = [];
  originalWrite = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalWrite.stdout;
  process.stderr.write = originalWrite.stderr;
  for (const [k, v] of snapshot) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  snapshot.clear();
});

const stdout = (): string => stdoutChunks.join("");
const stderr = (): string => stderrChunks.join("");

describe("CLI", () => {
  it("--help exits 0", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout()).toMatch(/keeperhub-publish/);
  });

  it("--version exits 0 with version", async () => {
    const code = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout()).toMatch(/0\.1\.0/);
  });

  it("rejects bare workflow id without --price", async () => {
    const code = await run(["wf_abc"]);
    expect(code).not.toBe(0);
    expect(stderr()).toMatch(/required option.*price/i);
  });

  it("dry-run prints the would-be registration without calling the gateway", async () => {
    const code = await run([
      "wf_demo",
      "--price",
      "0.02",
      "--currency",
      "USDC",
      "--chain",
      "base-sepolia",
      "--pay-to",
      "0x1111111111111111111111111111111111111111",
      "--keeperhub-api-key",
      "kh_realkey",
      "--admin-token",
      "test-admin-token-1234567890",
      "--dry-run",
    ]);
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toMatch(/dry-run/);
    expect(out).toMatch(/wf_demo/);
    expect(out).toMatch(/http:\/\/localhost:3030\/run\/wf_demo/);
  });

  it("dry-run --json emits a single JSON line", async () => {
    const code = await run([
      "wf_demo",
      "--price",
      "0.02",
      "--pay-to",
      "0x1111111111111111111111111111111111111111",
      "--keeperhub-api-key",
      "kh_realkey",
      "--admin-token",
      "test-admin-token-1234567890",
      "--dry-run",
      "--json",
    ]);
    expect(code).toBe(0);
    const out = stdout().trim();
    const parsed = JSON.parse(out) as { workflowId: string; dryRun: boolean };
    expect(parsed.workflowId).toBe("wf_demo");
    expect(parsed.dryRun).toBe(true);
  });

  it("rejects unsupported chain with exit code 2", async () => {
    const code = await run([
      "wf_demo",
      "--price",
      "0.02",
      "--chain",
      "polygon",
      "--pay-to",
      "0x1111111111111111111111111111111111111111",
      "--keeperhub-api-key",
      "kh_realkey",
      "--admin-token",
      "test-admin-token-1234567890",
      "--dry-run",
    ]);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/invalid_chain/);
  });

  it("rejects missing API key with exit code 2", async () => {
    const code = await run([
      "wf_demo",
      "--price",
      "0.02",
      "--pay-to",
      "0x1111111111111111111111111111111111111111",
      "--admin-token",
      "test-admin-token-1234567890",
      "--dry-run",
    ]);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/missing_keeperhub_api_key/);
  });

  it("status command without admin token exits 2", async () => {
    const code = await run(["status", "wf_demo"]);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/missing_gateway_admin_token/);
  });

  it("unpublish without --yes exits 2 (does NOT silently succeed)", async () => {
    const code = await run([
      "unpublish",
      "wf_demo",
      "--admin-token",
      "test-admin-token-1234567890",
    ]);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/confirmation_required/);
  });
});
