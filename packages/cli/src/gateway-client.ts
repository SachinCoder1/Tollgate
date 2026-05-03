/**
 * Typed HTTP client for the gateway's /admin/* surface. CLI-side counterpart
 * to packages/gateway/src/admin/routes.ts. Translates HTTP failures into the
 * CLI's typed error classes so the formatter can render them consistently.
 */

import {
  GatewayAuthError,
  GatewayUnexpectedError,
  GatewayUnreachableError,
  GatewayValidationError,
} from "./errors.js";

export interface RegisteredWorkflowDTO {
  workflowId: string;
  price: string;
  currency: string;
  network: string;
  payTo: string;
  description?: string;
  endpointUrl: string;
  registeredAt: string;
  keeperhubApiBase?: string;
}

export interface RegisterWorkflowDTO {
  workflowId: string;
  price: string;
  currency: "USDC";
  network: string;
  payTo: string;
  description?: string;
  keeperhubApiKey: string;
  keeperhubApiBase?: string;
}

export interface GatewayClientOptions {
  baseUrl: string;
  adminToken: string;
  /** Per-request timeout. Defaults to 5s — admin calls are local. */
  timeoutMs?: number;
}

export class GatewayClient {
  readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly timeoutMs: number;

  constructor(opts: GatewayClientOptions) {
    this.baseUrl = stripTrailingSlash(opts.baseUrl);
    this.adminToken = opts.adminToken;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async registerWorkflow(req: RegisterWorkflowDTO): Promise<RegisteredWorkflowDTO> {
    return this.request<RegisteredWorkflowDTO>("POST", "/admin/workflows", req);
  }

  async listWorkflows(): Promise<RegisteredWorkflowDTO[]> {
    const body = await this.request<{ workflows: RegisteredWorkflowDTO[] }>(
      "GET",
      "/admin/workflows",
      undefined,
    );
    return body.workflows;
  }

  async getWorkflow(workflowId: string): Promise<RegisteredWorkflowDTO> {
    return this.request<RegisteredWorkflowDTO>(
      "GET",
      `/admin/workflows/${encodeURIComponent(workflowId)}`,
      undefined,
    );
  }

  async unpublishWorkflow(workflowId: string): Promise<void> {
    await this.request<null>(
      "DELETE",
      `/admin/workflows/${encodeURIComponent(workflowId)}`,
      undefined,
    );
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.adminToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      throw new GatewayUnreachableError(url, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return null as T;
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length === 0 ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (res.ok) return parsed as T;
    if (res.status === 401) throw new GatewayAuthError();
    if (res.status === 400) {
      const message =
        typeof parsed === "object" && parsed !== null && "message" in parsed
          ? String((parsed as Record<string, unknown>).message ?? "validation failed")
          : text;
      const details =
        typeof parsed === "object" && parsed !== null && "details" in parsed
          ? (parsed as Record<string, unknown>).details
          : undefined;
      throw new GatewayValidationError(message, details);
    }
    throw new GatewayUnexpectedError(res.status, text);
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
