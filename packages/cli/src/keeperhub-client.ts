/**
 * Minimal KeeperHub client used by the CLI for the workflow-ownership
 * precheck. We only need GET /workflow/{id}.
 *
 * UNVERIFIED: RECON Q7 documents the MCP `get_workflow` tool but does not
 * pin the REST equivalent. We assume `GET {api_base}/workflow/{id}` mirrors
 * the documented `POST /api/workflow/{id}/execute`. If this 404s for valid
 * workflows, callers can pass --skip-validation.
 */

import { WorkflowAccessDeniedError, WorkflowNotFoundError } from "./errors.js";

export interface KeeperHubClientOptions {
  apiBase: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface WorkflowSummary {
  workflowId: string;
  raw: unknown;
}

export class KeeperHubCliClient {
  readonly apiBase: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: KeeperHubClientOptions) {
    this.apiBase = stripTrailingSlash(opts.apiBase);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 7_000;
  }

  /**
   * Confirm that the API key has access to the workflow. Returns the raw
   * workflow body for downstream display; throws on auth/404.
   */
  async getWorkflow(workflowId: string): Promise<WorkflowSummary> {
    const url = `${this.apiBase}/workflow/${encodeURIComponent(workflowId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new WorkflowAccessDeniedError();
    if (res.status === 404) throw new WorkflowNotFoundError(workflowId);
    if (!res.ok) {
      // Treat other non-2xx as access-denied to be safe rather than letting
      // the publish proceed against a bogus workflow.
      throw new WorkflowAccessDeniedError();
    }
    const raw = (await res.json().catch(() => null)) as unknown;
    return { workflowId, raw };
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
