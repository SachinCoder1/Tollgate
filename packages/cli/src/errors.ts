/**
 * CLI error hierarchy. Each subclass carries an exit code so the top-level
 * runner can map failures to a stable, scriptable status.
 *
 * Exit codes:
 *   2 — invalid input (env var missing, bad flag, bad value)
 *   3 — KeeperHub-side rejection (workflow not found, access denied)
 *   4 — gateway-side connectivity / auth failure
 *   5 — gateway returned a 4xx that wasn't auth (e.g. validation)
 */

export class KeepertollCliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: unknown;

  constructor(code: string, message: string, exitCode: number, details?: unknown) {
    super(message);
    this.name = code;
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class MissingApiKeyError extends KeepertollCliError {
  constructor() {
    super(
      "missing_keeperhub_api_key",
      "KEEPERHUB_API_KEY is not set. Pass --keeperhub-api-key or set the env var. Get a key from app.keeperhub.com → Settings → API Keys.",
      2,
    );
  }
}

export class MissingAdminTokenError extends KeepertollCliError {
  constructor() {
    super(
      "missing_gateway_admin_token",
      "GATEWAY_ADMIN_TOKEN is not set. Pass --admin-token or set the env var. It must match the gateway's GATEWAY_ADMIN_TOKEN.",
      2,
    );
  }
}

export class MissingPayToError extends KeepertollCliError {
  constructor() {
    super(
      "missing_pay_to",
      "no payTo address. Pass --pay-to 0x... or set X402_PAY_TO. This is the wallet that receives USDC for paid calls.",
      2,
    );
  }
}

export class InvalidPriceError extends KeepertollCliError {
  constructor(value: string) {
    super(
      "invalid_price",
      `--price ${JSON.stringify(value)} must be a positive decimal with up to 6 fractional digits (e.g. 0.02).`,
      2,
    );
  }
}

export class InvalidChainError extends KeepertollCliError {
  constructor(value: string, allowed: readonly string[]) {
    super(
      "invalid_chain",
      `--chain ${JSON.stringify(value)} not supported. Allowed: ${allowed.join(", ")}.`,
      2,
    );
  }
}

export class InvalidAddressError extends KeepertollCliError {
  constructor(field: string, value: string) {
    super(
      "invalid_address",
      `${field} ${JSON.stringify(value)} must be a 0x-prefixed 40-char hex address.`,
      2,
    );
  }
}

export class InvalidWorkflowIdError extends KeepertollCliError {
  constructor(value: string) {
    super(
      "invalid_workflow_id",
      `workflow id ${JSON.stringify(value)} must be 16+ alphanumeric chars (KeeperHub format) or our wf_… form.`,
      2,
    );
  }
}

export class WorkflowNotFoundError extends KeepertollCliError {
  constructor(workflowId: string) {
    super(
      "workflow_not_found",
      `KeeperHub returned 404 for workflow ${workflowId}. Check the ID, or use --skip-validation to bypass the precheck.`,
      3,
    );
  }
}

export class WorkflowAccessDeniedError extends KeepertollCliError {
  constructor() {
    super(
      "workflow_access_denied",
      "KeeperHub rejected the API key (401/403). Check that the key is org-scoped and active.",
      3,
    );
  }
}

export class GatewayUnreachableError extends KeepertollCliError {
  constructor(url: string, cause: string) {
    super(
      "gateway_unreachable",
      `could not reach gateway at ${url}: ${cause}. Is the gateway running? Try: pnpm --filter @keepertoll/gateway dev`,
      4,
    );
  }
}

export class GatewayAuthError extends KeepertollCliError {
  constructor() {
    super(
      "gateway_auth_failed",
      "gateway rejected the admin token. Check GATEWAY_ADMIN_TOKEN matches on both ends.",
      4,
    );
  }
}

export class GatewayValidationError extends KeepertollCliError {
  constructor(message: string, details?: unknown) {
    super("gateway_validation_failed", `gateway rejected request: ${message}`, 5, details);
  }
}

export class ConfirmationRequiredError extends KeepertollCliError {
  constructor(action: string) {
    super("confirmation_required", `refusing to ${action} without --yes`, 2);
  }
}

export class GatewayUnexpectedError extends KeepertollCliError {
  constructor(status: number, body: string) {
    super(
      "gateway_unexpected_status",
      `gateway returned unexpected ${status}: ${body.slice(0, 300)}`,
      5,
    );
  }
}
