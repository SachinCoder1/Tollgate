import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type PublishFlags, resolveManage, resolvePublish } from "../src/config.ts";
import {
  InvalidAddressError,
  InvalidChainError,
  InvalidPriceError,
  InvalidWorkflowIdError,
  MissingAdminTokenError,
  MissingApiKeyError,
  MissingPayToError,
} from "../src/errors.ts";

const ENV_KEYS = [
  "X402_PAY_TO",
  "KEEPERHUB_API_KEY",
  "KEEPERHUB_API_BASE",
  "GATEWAY_PUBLIC_URL",
  "GATEWAY_ADMIN_TOKEN",
] as const;
const snapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ENV_KEYS) {
    snapshot.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const [k, v] of snapshot) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  snapshot.clear();
});

const baseFlags = (overrides: Partial<PublishFlags> = {}): PublishFlags => ({
  price: "0.02",
  currency: "USDC",
  chain: "base-sepolia",
  payTo: "0x1111111111111111111111111111111111111111",
  keeperhubApiKey: "kh_realkey",
  adminToken: "real-admin-token-1234567890",
  ...overrides,
});

describe("resolvePublish", () => {
  it("resolves a valid set of flags", () => {
    const cfg = resolvePublish("wf_demo", baseFlags());
    expect(cfg.workflowId).toBe("wf_demo");
    expect(cfg.price).toBe("0.02");
    expect(cfg.chain).toBe("base-sepolia");
    expect(cfg.payTo).toBe("0x1111111111111111111111111111111111111111");
    expect(cfg.gatewayUrl).toBe("http://localhost:3030");
    expect(cfg.keeperhubApiBase).toBe("https://app.keeperhub.com/api");
  });

  it("falls back to env for payTo, api key, admin token, gateway url, api base", () => {
    process.env.X402_PAY_TO = "0x2222222222222222222222222222222222222222";
    process.env.KEEPERHUB_API_KEY = "kh_envkey";
    process.env.GATEWAY_ADMIN_TOKEN = "env-admin-token";
    process.env.GATEWAY_PUBLIC_URL = "http://gateway.local:9000/";
    process.env.KEEPERHUB_API_BASE = "https://staging.keeperhub.com/api";
    const cfg = resolvePublish("wf_demo", { price: "0.02" });
    expect(cfg.payTo).toBe("0x2222222222222222222222222222222222222222");
    expect(cfg.keeperhubApiKey).toBe("kh_envkey");
    expect(cfg.adminToken).toBe("env-admin-token");
    expect(cfg.gatewayUrl).toBe("http://gateway.local:9000"); // trailing slash stripped
    expect(cfg.keeperhubApiBase).toBe("https://staging.keeperhub.com/api");
  });

  it.each([
    ["bad", "throws InvalidWorkflowIdError"],
    ["abc_123", "throws InvalidWorkflowIdError"],
    ["", "throws InvalidWorkflowIdError"],
  ])("rejects invalid workflow id %s (%s)", (id) => {
    expect(() => resolvePublish(id, baseFlags())).toThrow(InvalidWorkflowIdError);
  });

  it.each(["", "abc", "-0.02", "0.0000001", "0", "1e2"])("rejects invalid price %s", (price) => {
    expect(() => resolvePublish("wf_x", baseFlags({ price }))).toThrow(InvalidPriceError);
  });

  it("rejects unsupported chain", () => {
    expect(() => resolvePublish("wf_x", baseFlags({ chain: "polygon" }))).toThrow(
      InvalidChainError,
    );
  });

  it("rejects zero address payTo", () => {
    expect(() =>
      resolvePublish("wf_x", baseFlags({ payTo: "0x0000000000000000000000000000000000000000" })),
    ).toThrow(InvalidAddressError);
  });

  it("rejects missing payTo (no flag, no env)", () => {
    expect(() => resolvePublish("wf_x", baseFlags({ payTo: undefined }))).toThrow(
      MissingPayToError,
    );
  });

  it("rejects missing api key (no flag, placeholder env)", () => {
    process.env.KEEPERHUB_API_KEY = "kh_replace_me";
    expect(() => resolvePublish("wf_x", baseFlags({ keeperhubApiKey: undefined }))).toThrow(
      MissingApiKeyError,
    );
  });

  it("rejects missing admin token (no flag, placeholder env)", () => {
    process.env.GATEWAY_ADMIN_TOKEN = "replace_me_with_a_long_random_string";
    expect(() => resolvePublish("wf_x", baseFlags({ adminToken: undefined }))).toThrow(
      MissingAdminTokenError,
    );
  });
});

describe("resolveManage", () => {
  it("requires admin token", () => {
    expect(() => resolveManage({})).toThrow(MissingAdminTokenError);
  });

  it("resolves with explicit flags", () => {
    const cfg = resolveManage({ adminToken: "tok", gatewayUrl: "http://x.test" });
    expect(cfg.adminToken).toBe("tok");
    expect(cfg.gatewayUrl).toBe("http://x.test");
  });
});
