/**
 * Admin routes for the gateway. Used by the keeperhub-publish CLI to
 * register, list, and unregister workflows. All routes require the bearer
 * token enforced by `./auth.ts`.
 */

import { Hono } from "hono";

import type { AuditLog } from "../audit.js";
import { ValidationError, WorkflowNotRegisteredError } from "../errors.js";
import type { Registry, StoredWorkflow } from "../registry.js";
import {
  type AdminListResponse,
  RegisterWorkflowRequestSchema,
  type RegisteredWorkflow,
} from "../types.js";

interface AdminDeps {
  registry: Registry;
  /** Public origin used to build endpointUrl on register. */
  publicUrl: string;
  /** Optional audit log surfaced via GET /admin/audit. */
  audit?: AuditLog;
}

export function buildAdminRoutes({ registry, publicUrl, audit }: AdminDeps): Hono {
  const r = new Hono();

  r.post("/workflows", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = RegisterWorkflowRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("invalid register request", parsed.error.flatten());
    }
    const req = parsed.data;
    const now = new Date().toISOString();
    const stored: StoredWorkflow = {
      workflowId: req.workflowId,
      price: req.price,
      currency: req.currency,
      network: req.network,
      payTo: req.payTo,
      ...(req.description !== undefined ? { description: req.description } : {}),
      ...(req.keeperhubApiBase !== undefined ? { keeperhubApiBase: req.keeperhubApiBase } : {}),
      endpointUrl: `${stripTrailingSlash(publicUrl)}/run/${req.workflowId}`,
      registeredAt: now,
      keeperhubApiKey: req.keeperhubApiKey,
    };
    await registry.upsert(stored);
    return c.json(redact(stored), 201);
  });

  r.get("/workflows", (c) => {
    const body: AdminListResponse = { workflows: registry.list().map(redact) };
    return c.json(body);
  });

  r.get("/workflows/:workflowId", (c) => {
    const id = c.req.param("workflowId");
    const stored = registry.get(id);
    if (!stored) throw new WorkflowNotRegisteredError(id);
    return c.json(redact(stored));
  });

  r.delete("/workflows/:workflowId", async (c) => {
    const id = c.req.param("workflowId");
    const removed = await registry.remove(id);
    if (!removed) throw new WorkflowNotRegisteredError(id);
    return c.body(null, 204);
  });

  r.get("/audit", async (c) => {
    const limit = clampLimit(c.req.query("limit"));
    const entries = audit ? await audit.tail(limit) : [];
    return c.json({ entries, limit, audit_enabled: audit !== undefined });
  });

  return r;
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 500);
}

function redact(s: StoredWorkflow): RegisteredWorkflow {
  const { keeperhubApiKey: _omit, ...rest } = s;
  void _omit;
  return rest;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
