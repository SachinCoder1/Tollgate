/**
 * The /run/:workflowId route. Handles the full x402 dance:
 *
 *   1. Lookup workflow by URL param.
 *   2. If no X-PAYMENT header → 402 with PaymentRequirements.
 *   3. Decode X-PAYMENT, ask facilitator to verify. Failure → 402.
 *   4. Call KeeperHub `execute`. Failure → 502, do NOT settle.
 *   5. Ask facilitator to settle. Failure → 200 with X-Settlement-Error header.
 *   6. If ?wait=true, poll KeeperHub `status` until terminal or maxWaitMs.
 *   7. Return RunResponse.
 *
 * The handler reads the registry per-request so dynamic per-workflow pricing
 * works without re-mounting the route on every CLI publish.
 */

import type { Context, Hono } from "hono";
import { decodePayment } from "x402/schemes";
import type { PaymentPayload } from "x402/types";
import { settleResponseHeader } from "x402/types";

import { type AuditLog, previewOutput } from "../audit.js";
import {
  KeeperHubAuthError,
  KeeperHubTimeoutError,
  KeeperHubUpstreamError,
  KeeperHubWorkflowNotFoundError,
  PaymentValidationError,
  WorkflowNotRegisteredError,
} from "../errors.js";
import { type ExecuteResponse, KeeperHubClient } from "../keeperhub/client.js";
import type { Registry, StoredWorkflow } from "../registry.js";
import type { RunResponse, SettlementMeta } from "../types.js";
import { log } from "../util/log.js";

import { buildPaymentRequirements } from "./challenge.js";
import type { FacilitatorClient } from "./facilitator.js";

interface HandlerDeps {
  registry: Registry;
  facilitator: FacilitatorClient;
  publicUrl: string;
  /** Optional audit log; when set, every successful pay+execute appends a row. */
  audit?: AuditLog;
  /** Default sync-mode max wait when ?wait=true is set. */
  defaultMaxWaitMs?: number;
  /** Default KeeperHub API base if not set per workflow. */
  defaultKeeperhubApiBase?: string;
}

const X402_VERSION = 1;
const TERMINAL_STATUSES = new Set(["success", "error", "cancelled", "failed", "completed"]);

export function mountRunRoutes(app: Hono, deps: HandlerDeps): void {
  const handler = (c: Context) => handleRun(c, deps);
  app.post("/run/:workflowId", handler);
  app.get("/run/:workflowId", handler);
  app.get("/run/:workflowId/status/:executionId", (c) => handleStatus(c, deps));
}

async function handleRun(c: Context, deps: HandlerDeps): Promise<Response> {
  const workflowId = c.req.param("workflowId") ?? "";
  const workflow = deps.registry.get(workflowId);
  if (!workflow) throw new WorkflowNotRegisteredError(workflowId);

  const resourceUrl = `${stripTrailingSlash(deps.publicUrl)}/run/${workflow.workflowId}`;
  const requirements = buildPaymentRequirements({ workflow, resourceUrl });

  const paymentHeader = c.req.header("x-payment") ?? c.req.header("X-PAYMENT");
  if (!paymentHeader) {
    return c.json(
      {
        x402Version: X402_VERSION,
        accepts: [requirements],
        error: "X-PAYMENT header is required",
      },
      402,
    );
  }

  let payload: PaymentPayload;
  try {
    payload = decodePayment(paymentHeader);
  } catch (err: unknown) {
    return c.json(
      {
        x402Version: X402_VERSION,
        accepts: [requirements],
        error: `invalid X-PAYMENT header: ${err instanceof Error ? err.message : String(err)}`,
      },
      402,
    );
  }

  try {
    await deps.facilitator.verify(payload, requirements);
  } catch (err: unknown) {
    const message = err instanceof PaymentValidationError ? err.message : String(err);
    log.warn("payment verify failed", { workflowId, error: message });
    return c.json({ x402Version: X402_VERSION, accepts: [requirements], error: message }, 402);
  }

  // Forward request body (if any) as the workflow input. GET → no input.
  let input: unknown = {};
  if (c.req.method !== "GET") {
    const text = await c.req.text();
    if (text.length > 0) {
      try {
        input = JSON.parse(text);
      } catch {
        input = text;
      }
    }
  }

  const apiBase = workflow.keeperhubApiBase ?? deps.defaultKeeperhubApiBase;
  const kh = new KeeperHubClient({
    apiKey: workflow.keeperhubApiKey,
    ...(apiBase !== undefined ? { apiBase } : {}),
  });

  let executed: ExecuteResponse;
  try {
    executed = await kh.executeWorkflow(workflow.workflowId, input);
  } catch (err: unknown) {
    // Fail-closed: do NOT settle if KeeperHub kickoff failed. The caller still
    // owns the EIP-3009 authorization but it expires unspent.
    log.error("KeeperHub execute failed; skipping settle", {
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof KeeperHubAuthError) throw err;
    if (err instanceof KeeperHubWorkflowNotFoundError) throw err;
    if (err instanceof KeeperHubTimeoutError) throw err;
    throw err instanceof KeeperHubUpstreamError ? err : new KeeperHubUpstreamError(String(err));
  }

  // Settle. If settlement fails, return success but flag it on a header.
  const headers = new Headers({ "content-type": "application/json" });
  let settlement: SettlementMeta = { network: workflow.network };
  try {
    const settled = await deps.facilitator.settle(payload, requirements);
    settlement = {
      network: workflow.network,
      ...(settled.txHash !== undefined ? { txHash: settled.txHash } : {}),
      ...(settled.payer !== undefined ? { payer: settled.payer } : {}),
    };
    // x402 spec response header — base64-encoded SettleResponse — lets clients
    // (and chained gateways) audit settlement.
    try {
      const headerValue = settleResponseHeader(
        settled.raw as Parameters<typeof settleResponseHeader>[0],
      );
      headers.set("x-payment-response", headerValue);
    } catch (err: unknown) {
      log.warn("failed to encode X-PAYMENT-RESPONSE header", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err: unknown) {
    log.warn("settle failed; returning execution result anyway", {
      workflowId,
      executionId: executed.executionId,
      error: err instanceof Error ? err.message : String(err),
    });
    headers.set("x-settlement-error", err instanceof Error ? err.message : String(err));
  }

  // Sync mode: poll until terminal or maxWaitMs.
  const wait = c.req.query("wait") === "true";
  let body: RunResponse;
  if (wait) {
    const maxWait = clampPositiveInt(c.req.query("maxWaitMs"), deps.defaultMaxWaitMs ?? 30_000);
    const polled = await pollUntilTerminal(kh, executed.executionId, maxWait);
    body = buildPolledResponse(workflow, executed, polled, settlement);
  } else {
    body = {
      status: "pending",
      executionId: executed.executionId,
      ...(executed.runId !== undefined ? { runId: executed.runId } : {}),
      statusUrl: `${resourceUrl}/status/${executed.executionId}`,
      payment: settlement,
    };
  }

  // Audit row — best-effort, never blocks the response.
  if (deps.audit) {
    void deps.audit.append({
      ts: new Date().toISOString(),
      workflowId,
      ...(settlement.payer !== undefined ? { payer: settlement.payer } : {}),
      ...(settlement.txHash !== undefined ? { txHash: settlement.txHash } : {}),
      network: workflow.network,
      outputPreview: previewOutput(body),
    });
  }

  return new Response(JSON.stringify(body), { headers });
}

async function handleStatus(c: Context, deps: HandlerDeps): Promise<Response> {
  const workflowId = c.req.param("workflowId") ?? "";
  const executionId = c.req.param("executionId") ?? "";
  const workflow = deps.registry.get(workflowId);
  if (!workflow) throw new WorkflowNotRegisteredError(workflowId);
  const apiBase = workflow.keeperhubApiBase ?? deps.defaultKeeperhubApiBase;
  const kh = new KeeperHubClient({
    apiKey: workflow.keeperhubApiKey,
    ...(apiBase !== undefined ? { apiBase } : {}),
  });
  const status = await kh.getExecutionStatus(executionId);
  return c.json(status);
}

interface PolledResult {
  status: string;
  output?: unknown;
  error?: string;
  durationMs: number;
}

async function pollUntilTerminal(
  kh: KeeperHubClient,
  executionId: string,
  maxWaitMs: number,
): Promise<PolledResult> {
  const start = Date.now();
  let backoffMs = 500;
  while (Date.now() - start < maxWaitMs) {
    const status = await kh.getExecutionStatus(executionId);
    if (TERMINAL_STATUSES.has(status.status)) {
      // /status doesn't carry the workflow's output — fetch /logs once we
      // know the run is terminal. See FEEDBACK.md KH-DOCS-1.
      let output: unknown;
      let error: string | undefined;
      try {
        const logs = await kh.getExecutionLogs(executionId);
        // KH wraps Run Code outputs as { logs: [], result: <userReturn>, success: true }.
        // Unwrap that envelope so SDKs see the user's return value directly.
        // See FEEDBACK.md KH-UX-16.
        output = unwrapKhRunCodeOutput(logs.output);
        if (typeof logs.error === "string" && logs.error.length > 0) {
          error = logs.error;
        }
      } catch (err: unknown) {
        log.warn("KH /logs fetch failed; returning status without output", {
          executionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return {
        status: status.status,
        ...(output !== undefined ? { output } : {}),
        ...(error !== undefined ? { error } : {}),
        durationMs: Date.now() - start,
      };
    }
    const remaining = maxWaitMs - (Date.now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(backoffMs, remaining));
    backoffMs = Math.min(backoffMs * 1.5, 4000);
  }
  return { status: "running", durationMs: Date.now() - start };
}

function buildPolledResponse(
  workflow: StoredWorkflow,
  executed: ExecuteResponse,
  polled: PolledResult,
  payment: SettlementMeta,
): RunResponse {
  if (polled.status === "success" || polled.status === "completed") {
    return {
      status: "success",
      executionId: executed.executionId,
      ...(executed.runId !== undefined ? { runId: executed.runId } : {}),
      output: polled.output ?? null,
      durationMs: polled.durationMs,
      payment,
    };
  }
  if (polled.status === "error" || polled.status === "failed") {
    return {
      status: "error",
      executionId: executed.executionId,
      ...(executed.runId !== undefined ? { runId: executed.runId } : {}),
      error: polled.error ?? "workflow execution failed",
      payment,
    };
  }
  if (polled.status === "cancelled") {
    return {
      status: "cancelled",
      executionId: executed.executionId,
      ...(executed.runId !== undefined ? { runId: executed.runId } : {}),
      error: "workflow cancelled",
      payment,
    };
  }
  // Timeout while still running → degrade to async.
  return {
    status: "pending",
    executionId: executed.executionId,
    ...(executed.runId !== undefined ? { runId: executed.runId } : {}),
    statusUrl: `${stripTrailingSlash(workflow.endpointUrl)}/status/${executed.executionId}`,
    payment,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * KeeperHub's Run Code action wraps a workflow's terminal return value as
 * `{ logs: [], result: <userReturn>, success: true }`. Other action types
 * (Read Contract, Write Contract, etc.) return their own native shape.
 * If we see the Run Code envelope, unwrap to `result` so callers see the
 * user-defined object directly.
 */
function unwrapKhRunCodeOutput(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    "result" in value &&
    "success" in value &&
    "logs" in value
  ) {
    return (value as { result: unknown }).result;
  }
  return value;
}

function clampPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 120_000);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
