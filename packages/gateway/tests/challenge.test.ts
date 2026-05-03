import { describe, expect, it } from "vitest";

import type { StoredWorkflow } from "../src/registry.ts";
import { buildPaymentRequirements, toAtomic } from "../src/x402/challenge.ts";

const wf = (overrides: Partial<StoredWorkflow> = {}): StoredWorkflow => ({
  workflowId: "wf_demo",
  price: "0.02",
  currency: "USDC",
  network: "base-sepolia",
  payTo: "0x1111111111111111111111111111111111111111",
  endpointUrl: "http://localhost:3030/run/wf_demo",
  registeredAt: "2026-05-02T00:00:00.000Z",
  keeperhubApiKey: "kh_test",
  ...overrides,
});

describe("toAtomic", () => {
  it.each([
    ["1", 6, "1000000"],
    ["0.02", 6, "20000"],
    ["0.000001", 6, "1"],
    ["10.5", 6, "10500000"],
    ["0", 6, "0"],
  ])("toAtomic(%s, %s) = %s", (input, decimals, expected) => {
    expect(toAtomic(input, decimals)).toBe(expected);
  });
});

describe("buildPaymentRequirements", () => {
  it("builds a Base Sepolia USDC challenge for a 0.02 price", () => {
    const req = buildPaymentRequirements({
      workflow: wf(),
      resourceUrl: "http://localhost:3030/run/wf_demo",
    });
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("base-sepolia");
    expect(req.maxAmountRequired).toBe("20000");
    expect(req.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(req.payTo).toBe("0x1111111111111111111111111111111111111111");
    expect(req.resource).toBe("http://localhost:3030/run/wf_demo");
    expect(req.extra).toEqual({ name: "USDC", version: "2" });
  });

  it("uses the workflow description when present", () => {
    const req = buildPaymentRequirements({
      workflow: wf({ description: "Aave health for one wallet" }),
      resourceUrl: "http://localhost:3030/run/wf_demo",
    });
    expect(req.description).toBe("Aave health for one wallet");
  });

  it("falls back to a generic description without one configured", () => {
    const req = buildPaymentRequirements({
      workflow: wf(),
      resourceUrl: "http://localhost:3030/run/wf_demo",
    });
    expect(req.description).toMatch(/wf_demo/);
  });
});
