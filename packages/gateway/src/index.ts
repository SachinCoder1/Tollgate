/**
 * `@keepertoll/gateway` — public surface.
 *
 * Phase 1 stub. Real exports (registry, x402 middleware factory, KeeperHub
 * proxy) land in Phase 2.
 */

/** Version of the gateway server, exposed for `/healthz` and CLI handshakes. */
export const GATEWAY_VERSION = "0.0.0";

export { app } from "./server.js";
