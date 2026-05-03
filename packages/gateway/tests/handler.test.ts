/**
 * End-to-end style tests for the run handler:
 *
 *   - 402 with PaymentRequirements when no X-PAYMENT header is sent
 *   - 402 when the facilitator rejects verify
 *   - 502 (no settle) when KeeperHub kickoff fails
 *   - 200 + statusUrl on the happy async path
 *
 * The facilitator and KeeperHub call sites are mocked via fetch stubs and a
 * fake facilitator. We do NOT spin up a real x402 facilitator.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "x402/types";

import { KeeperHubUpstreamError, installErrorHandler } from "../src/errors.ts";
import { Registry, type StoredWorkflow } from "../src/registry.ts";
import type { FacilitatorClient } from "../src/x402/facilitator.ts";
import { mountRunRoutes } from "../src/x402/handler.ts";

const sampleWorkflow = (id = "wf_demo"): StoredWorkflow => ({
  workflowId: id,
  price: "0.02",
  currency: "USDC",
  network: "base-sepolia",
  payTo: "0x1111111111111111111111111111111111111111",
  endpointUrl: `http://localhost:3030/run/${id}`,
  registeredAt: "2026-05-02T00:00:00.000Z",
  keeperhubApiKey: "kh_test",
});

const FAKE_PAYMENT_HEADER = Buffer.from(
  JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: {
      signature:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c",
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x1111111111111111111111111111111111111111",
        value: "20000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    },
  }),
).toString("base64");

let dir = "";
let registry: Registry;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "keepertoll-handler-"));
  registry = new Registry(join(dir, "registry.json"));
  await registry.load();
  await registry.upsert(sampleWorkflow());
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function buildApp(facilitator: FacilitatorClient, fetchImpl: typeof fetch): Hono {
  globalThis.fetch = fetchImpl;
  const app = new Hono();
  installErrorHandler(app);
  mountRunRoutes(app, {
    registry,
    facilitator,
    publicUrl: "http://localhost:3030",
    defaultMaxWaitMs: 1_000,
  });
  return app;
}

const okFacilitator: FacilitatorClient = {
  verify: async () => undefined,
  settle: async () => ({
    txHash: "0xfeedface",
    payer: "0xpayer",
    raw: { transaction: "0xfeedface", success: true, network: "base-sepolia" },
  }),
};

const stubFetchOk = (body: unknown): typeof fetch =>
  ((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;

const stubFetchStatus = (status: number, body = ""): typeof fetch =>
  ((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

describe("POST /run/:workflowId — 402 path", () => {
  it("returns 402 with PaymentRequirements when X-PAYMENT is missing", async () => {
    const app = buildApp(okFacilitator, stubFetchOk({}));
    const res = await app.request("/run/wf_demo", { method: "POST" });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { x402Version: number; accepts: PaymentRequirements[] };
    expect(body.x402Version).toBe(1);
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]?.network).toBe("base-sepolia");
    expect(body.accepts[0]?.maxAmountRequired).toBe("20000");
  });

  it("returns 402 when facilitator verify rejects", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("insufficient_funds"));
    const facilitator: FacilitatorClient = {
      verify: verify as unknown as FacilitatorClient["verify"],
      settle: vi.fn() as unknown as FacilitatorClient["settle"],
    };
    const app = buildApp(facilitator, stubFetchOk({}));
    const res = await app.request("/run/wf_demo", {
      method: "POST",
      headers: { "x-payment": FAKE_PAYMENT_HEADER },
    });
    expect(res.status).toBe(402);
    expect(verify).toHaveBeenCalledOnce();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
});

describe("POST /run/:workflowId — KeeperHub failure path", () => {
  it("does NOT settle when KeeperHub execute fails (fail-closed)", async () => {
    const settle = vi.fn();
    const facilitator: FacilitatorClient = {
      verify: async () => undefined,
      settle: settle as unknown as FacilitatorClient["settle"],
    };
    const app = buildApp(facilitator, stubFetchStatus(500, "boom"));
    const res = await app.request("/run/wf_demo", {
      method: "POST",
      headers: { "x-payment": FAKE_PAYMENT_HEADER },
    });
    expect(res.status).toBe(502);
    expect(settle).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/keeperhub/);
  });
});

describe("POST /run/:workflowId — happy async path", () => {
  it("verifies, executes, settles, then returns pending + statusUrl", async () => {
    const settle = vi.fn().mockResolvedValue({
      txHash: "0xtx",
      payer: "0xpayer",
      raw: { transaction: "0xtx", success: true, network: "base-sepolia" },
    });
    const facilitator: FacilitatorClient = {
      verify: async () => undefined,
      settle: settle as unknown as FacilitatorClient["settle"],
    };
    const app = buildApp(
      facilitator,
      stubFetchOk({ executionId: "exec_42", runId: "run_42", status: "pending" }),
    );
    const res = await app.request("/run/wf_demo", {
      method: "POST",
      headers: { "x-payment": FAKE_PAYMENT_HEADER },
      body: JSON.stringify({ wallet: "0xabc" }),
    });
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledOnce();
    const body = (await res.json()) as { status: string; executionId: string; statusUrl: string };
    expect(body.status).toBe("pending");
    expect(body.executionId).toBe("exec_42");
    expect(body.statusUrl).toBe("http://localhost:3030/run/wf_demo/status/exec_42");
  });

  it("returns 404 for an unregistered workflow", async () => {
    const app = buildApp(okFacilitator, stubFetchOk({}));
    const res = await app.request("/run/wf_missing", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

// Defensive: silence unused import warning for KeeperHubUpstreamError if tests
// later reference it.
void KeeperHubUpstreamError;
void ((_p: PaymentPayload) => undefined);
