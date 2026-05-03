import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adminAuth } from "../src/admin/auth.ts";
import { buildAdminRoutes } from "../src/admin/routes.ts";
import { installErrorHandler } from "../src/errors.ts";
import { Registry } from "../src/registry.ts";

const ADMIN_TOKEN = "test-admin-token-1234567890";

let dir = "";
let registry: Registry;
let app: Hono;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "keepertoll-admin-"));
  registry = new Registry(join(dir, "registry.json"));
  await registry.load();
  app = new Hono();
  installErrorHandler(app);
  app.use("/admin/*", adminAuth(ADMIN_TOKEN));
  app.route("/admin", buildAdminRoutes({ registry, publicUrl: "http://localhost:3030" }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${ADMIN_TOKEN}` } as const;

const validRegisterBody = {
  workflowId: "wf_demo",
  price: "0.02",
  currency: "USDC",
  network: "base-sepolia",
  payTo: "0x1111111111111111111111111111111111111111",
  keeperhubApiKey: "kh_test_key",
};

describe("admin auth", () => {
  it("rejects with 401 when no Authorization header", async () => {
    const res = await app.request("/admin/workflows", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when token is wrong", async () => {
    const res = await app.request("/admin/workflows", {
      method: "GET",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("admin routes", () => {
  it("registers, lists, gets, and deletes workflows", async () => {
    // Empty initial list
    let res = await app.request("/admin/workflows", { headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { workflows: unknown[] }).workflows).toEqual([]);

    // Register
    res = await app.request("/admin/workflows", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(validRegisterBody),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { workflowId: string; endpointUrl: string };
    expect(created.workflowId).toBe("wf_demo");
    expect(created.endpointUrl).toBe("http://localhost:3030/run/wf_demo");
    // kh key must NOT leak
    expect(JSON.stringify(created)).not.toContain("kh_test_key");

    // List
    res = await app.request("/admin/workflows", { headers: auth });
    const list = (await res.json()) as { workflows: Array<{ workflowId: string }> };
    expect(list.workflows).toHaveLength(1);

    // Get one
    res = await app.request("/admin/workflows/wf_demo", { headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { workflowId: string }).workflowId).toBe("wf_demo");

    // Delete
    res = await app.request("/admin/workflows/wf_demo", { method: "DELETE", headers: auth });
    expect(res.status).toBe(204);

    // Get after delete → 404
    res = await app.request("/admin/workflows/wf_demo", { headers: auth });
    expect(res.status).toBe(404);
  });

  it("rejects malformed register payload with 400", async () => {
    const res = await app.request("/admin/workflows", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...validRegisterBody, price: "not-a-number" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unsupported network at registration time", async () => {
    const res = await app.request("/admin/workflows", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...validRegisterBody, network: "tempo" }),
    });
    expect(res.status).toBe(400);
  });
});
