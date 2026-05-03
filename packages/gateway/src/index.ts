/**
 * `@keepertoll/gateway` — public surface.
 *
 * Re-exports the small set of types + classes other packages (CLI, SDK,
 * tests) consume. The actual HTTP server lives in `./server.ts`.
 */

export { GATEWAY_VERSION } from "./version.js";
export { Registry } from "./registry.js";
export type { StoredWorkflow } from "./registry.js";
export { createApp, type GatewayConfig, type BuiltGateway } from "./server.js";
export {
  GatewayError,
  RegistryCorruptError,
  WorkflowNotRegisteredError,
  PaymentRequiredError,
  PaymentValidationError,
  SettlementError,
  KeeperHubAuthError,
  KeeperHubWorkflowNotFoundError,
  KeeperHubUpstreamError,
  KeeperHubTimeoutError,
  AdminAuthError,
  ValidationError,
} from "./errors.js";
export type {
  Currency,
  RegisteredWorkflow,
  RegisterWorkflowRequest,
  RunResponse,
  SettlementMeta,
  X402Network,
} from "./types.js";
export { SUPPORTED_CURRENCIES, SUPPORTED_X402_NETWORKS } from "./types.js";
