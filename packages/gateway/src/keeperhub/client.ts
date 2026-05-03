/**
 * Thin client for KeeperHub's REST API.
 *
 * Verified endpoints (live-tested 2026-05-03):
 *   POST {base}/workflow/{id}/execute             → { executionId, runId, status }
 *   GET  {base}/workflows/executions/{id}/status  → { status, nodeStatuses, progress }  (no output here)
 *   GET  {base}/workflows/executions/{id}/logs    → { execution: { status, output, error?, ... } }
 *
 * Verified body shape: `{ "input": <object> }` — confirmed correct after a
 * 4-shape probe (input / triggerData / bare / data). Other shapes silently
 * succeed at the API but pass empty data into the workflow.
 *
 * Verified output location: NOT in /status. Output lives at /logs under
 * `execution.output`. See FEEDBACK.md KH-DOCS-1.
 *
 * UNVERIFIED:
 *   - Default base URL is `https://app.keeperhub.com/api` (per `.env.example`).
 */

import {
  KeeperHubAuthError,
  KeeperHubTimeoutError,
  KeeperHubUpstreamError,
  KeeperHubWorkflowNotFoundError,
} from "../errors.js";

export const DEFAULT_KEEPERHUB_API_BASE = "https://app.keeperhub.com/api";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ExecuteResponse {
  executionId: string;
  runId?: string;
  status: string;
}

export interface ExecutionStatusResponse {
  status: "pending" | "running" | "success" | "error" | "cancelled" | string;
  nodeStatuses?: Array<{ nodeId: string; status: string }>;
  progress?: { totalSteps: number; completedSteps: number; percentage: number };
  output?: unknown;
}

export interface ExecutionLogsResponse {
  status: "pending" | "running" | "success" | "error" | "cancelled" | string;
  output?: unknown;
  error?: string | null;
  duration?: string | number;
  startedAt?: string;
  completedAt?: string;
}

export interface KeeperHubClientOptions {
  apiBase?: string;
  apiKey: string;
  timeoutMs?: number;
}

export class KeeperHubClient {
  readonly apiBase: string;
  readonly timeoutMs: number;
  private readonly apiKey: string;

  constructor(opts: KeeperHubClientOptions) {
    this.apiBase = stripTrailingSlash(opts.apiBase ?? DEFAULT_KEEPERHUB_API_BASE);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async executeWorkflow(workflowId: string, input: unknown): Promise<ExecuteResponse> {
    const url = `${this.apiBase}/workflow/${encodeURIComponent(workflowId)}/execute`;
    // UNVERIFIED: KeeperHub expects an `input` field; adjust if their API uses `inputs` or similar.
    const body = JSON.stringify({ input: input ?? {} });
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    return parseExecute(workflowId, res);
  }

  async getExecutionStatus(executionId: string): Promise<ExecutionStatusResponse> {
    const url = `${this.apiBase}/workflows/executions/${encodeURIComponent(executionId)}/status`;
    const res = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: this.headers(),
    });
    return parseStatus(res);
  }

  /**
   * Returns the full execution record including `output`. Used after polling
   * /status reaches a terminal state — /status alone never returns `output`.
   */
  async getExecutionLogs(executionId: string): Promise<ExecutionLogsResponse> {
    const url = `${this.apiBase}/workflows/executions/${encodeURIComponent(executionId)}/logs`;
    const res = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: this.headers(),
    });
    return parseLogs(res);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new KeeperHubTimeoutError(`KeeperHub request to ${url} timed out`);
      }
      throw new KeeperHubUpstreamError(
        `network error contacting KeeperHub: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseExecute(workflowId: string, res: Response): Promise<ExecuteResponse> {
  if (res.status === 401 || res.status === 403) throw new KeeperHubAuthError();
  if (res.status === 404) throw new KeeperHubWorkflowNotFoundError(workflowId);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new KeeperHubUpstreamError(`KeeperHub execute returned ${res.status}`, {
      body: text.slice(0, 500),
    });
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json || typeof json.executionId !== "string") {
    throw new KeeperHubUpstreamError("KeeperHub execute response missing executionId", {
      body: json,
    });
  }
  const runId = typeof json.runId === "string" ? json.runId : undefined;
  return {
    executionId: json.executionId,
    status: typeof json.status === "string" ? json.status : "pending",
    ...(runId !== undefined ? { runId } : {}),
  };
}

async function parseStatus(res: Response): Promise<ExecutionStatusResponse> {
  if (res.status === 401 || res.status === 403) throw new KeeperHubAuthError();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new KeeperHubUpstreamError(`KeeperHub status returned ${res.status}`, {
      body: text.slice(0, 500),
    });
  }
  const json = (await res.json().catch(() => null)) as ExecutionStatusResponse | null;
  if (!json || typeof json.status !== "string") {
    throw new KeeperHubUpstreamError("KeeperHub status response missing status", { body: json });
  }
  return json;
}

async function parseLogs(res: Response): Promise<ExecutionLogsResponse> {
  if (res.status === 401 || res.status === 403) throw new KeeperHubAuthError();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new KeeperHubUpstreamError(`KeeperHub logs returned ${res.status}`, {
      body: text.slice(0, 500),
    });
  }
  const body = (await res.json().catch(() => null)) as { execution?: ExecutionLogsResponse } | null;
  const exec = body?.execution;
  if (!exec || typeof exec.status !== "string") {
    throw new KeeperHubUpstreamError("KeeperHub logs response missing execution.status", {
      body,
    });
  }
  return exec;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
