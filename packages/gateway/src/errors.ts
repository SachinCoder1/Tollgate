/**
 * Typed error classes for the gateway. Every failure path raises one of these
 * so the central errorHandler middleware can map them to a stable JSON envelope.
 *
 *   { "error": "<code>", "message": "...", "details"?: <unknown> }
 */

import type { Context, Hono } from "hono";

export class GatewayError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: unknown;

  constructor(code: string, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = code;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class RegistryCorruptError extends GatewayError {
  constructor(message: string, details?: unknown) {
    super("registry_corrupt", message, 500, details);
  }
}

export class WorkflowNotRegisteredError extends GatewayError {
  constructor(workflowId: string) {
    super("workflow_not_registered", `workflow ${workflowId} is not registered`, 404, {
      workflowId,
    });
  }
}

export class PaymentRequiredError extends GatewayError {
  constructor(message: string, accepts: unknown, error?: string) {
    super("payment_required", message, 402, { accepts, error });
  }
}

export class PaymentValidationError extends GatewayError {
  constructor(reason: string, details?: unknown) {
    super("payment_validation_failed", reason, 402, details);
  }
}

export class SettlementError extends GatewayError {
  constructor(reason: string, details?: unknown) {
    super("settlement_failed", reason, 502, details);
  }
}

export class KeeperHubAuthError extends GatewayError {
  constructor(message = "KeeperHub rejected the stored API key") {
    super("keeperhub_auth_failed", message, 502);
  }
}

export class KeeperHubWorkflowNotFoundError extends GatewayError {
  constructor(workflowId: string) {
    super(
      "keeperhub_workflow_not_found",
      `KeeperHub returned 404 for workflow ${workflowId}`,
      502,
      { workflowId },
    );
  }
}

export class KeeperHubUpstreamError extends GatewayError {
  constructor(message: string, details?: unknown) {
    super("keeperhub_upstream_error", message, 502, details);
  }
}

export class KeeperHubTimeoutError extends GatewayError {
  constructor(message = "KeeperHub call timed out") {
    super("keeperhub_timeout", message, 504);
  }
}

export class AdminAuthError extends GatewayError {
  constructor(reason: "admin_token_required" | "admin_token_invalid") {
    super(
      reason,
      reason === "admin_token_required" ? "missing admin token" : "invalid admin token",
      401,
    );
  }
}

export class ValidationError extends GatewayError {
  constructor(message: string, details?: unknown) {
    super("validation_error", message, 400, details);
  }
}

/** Install the central error handler on a Hono app. Call once at app build. */
export function installErrorHandler(app: Hono): void {
  app.onError((err, c) => renderError(c, err));
}

export function renderError(c: Context, err: unknown): Response {
  if (err instanceof GatewayError) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      // hono's status type is narrow; the cast is to allow our codes
      err.httpStatus as Parameters<Context["json"]>[1],
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "internal_error", message }, 500);
}
