import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KeeperHubAuthError,
  KeeperHubUpstreamError,
  KeeperHubWorkflowNotFoundError,
} from "../src/errors.ts";
import { KeeperHubClient } from "../src/keeperhub/client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return ((url: string | URL | Request, init: RequestInit = {}) => {
    return Promise.resolve(handler(String(url), init));
  }) as unknown as typeof fetch;
}

describe("KeeperHubClient.executeWorkflow", () => {
  it("sends Authorization bearer + JSON body and parses executionId", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = mockFetch((url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ executionId: "exec_123", runId: "run_1", status: "pending" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const kh = new KeeperHubClient({ apiKey: "kh_xyz", apiBase: "https://example.com/api" });
    const out = await kh.executeWorkflow("wf_a", { foo: "bar" });
    expect(out).toEqual({ executionId: "exec_123", runId: "run_1", status: "pending" });
    expect(captured.url).toBe("https://example.com/api/workflow/wf_a/execute");
    expect((captured.init?.headers as Record<string, string>).authorization).toBe("Bearer kh_xyz");
    expect(JSON.parse(String(captured.init?.body))).toEqual({ input: { foo: "bar" } });
  });

  it("maps 401 to KeeperHubAuthError", async () => {
    globalThis.fetch = mockFetch(() => new Response("nope", { status: 401 }));
    const kh = new KeeperHubClient({ apiKey: "kh_xyz" });
    await expect(kh.executeWorkflow("wf_a", {})).rejects.toBeInstanceOf(KeeperHubAuthError);
  });

  it("maps 404 to KeeperHubWorkflowNotFoundError", async () => {
    globalThis.fetch = mockFetch(() => new Response("nope", { status: 404 }));
    const kh = new KeeperHubClient({ apiKey: "kh_xyz" });
    await expect(kh.executeWorkflow("wf_missing", {})).rejects.toBeInstanceOf(
      KeeperHubWorkflowNotFoundError,
    );
  });

  it("maps 500 to KeeperHubUpstreamError", async () => {
    globalThis.fetch = mockFetch(() => new Response("boom", { status: 500 }));
    const kh = new KeeperHubClient({ apiKey: "kh_xyz" });
    await expect(kh.executeWorkflow("wf_a", {})).rejects.toBeInstanceOf(KeeperHubUpstreamError);
  });

  it("maps response without executionId to KeeperHubUpstreamError", async () => {
    globalThis.fetch = mockFetch(
      () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const kh = new KeeperHubClient({ apiKey: "kh_xyz" });
    await expect(kh.executeWorkflow("wf_a", {})).rejects.toBeInstanceOf(KeeperHubUpstreamError);
  });
});
