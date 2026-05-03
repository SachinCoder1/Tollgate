/**
 * keepertoll gateway — entrypoint and Hono app factory.
 *
 *   - /healthz                         — liveness check
 *   - /admin/workflows                 — CLI-driven publish surface (auth: admin token)
 *   - /run/:workflowId                 — x402-paid execute proxy
 *   - /run/:workflowId/status/:execId  — free passthrough for execution status
 *
 * The factory `createApp(config)` is exported for tests; the file is also
 * runnable as a script (`node --import tsx src/server.ts`) for local dev.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { adminAuth } from "./admin/auth.js";
import { buildAdminRoutes } from "./admin/routes.js";
import { AuditLog } from "./audit.js";
import { installErrorHandler } from "./errors.js";
import { Registry } from "./registry.js";
import { log } from "./util/log.js";
import { GATEWAY_VERSION } from "./version.js";
import { createFacilitator } from "./x402/facilitator.js";
import { mountRunRoutes } from "./x402/handler.js";

export interface GatewayConfig {
  publicUrl: string;
  registryPath: string;
  adminToken: string;
  facilitatorUrl: string;
  /** When set, every successful pay+execute appends a JSONL audit row here. */
  auditLogPath?: string;
  defaultMaxWaitMs?: number;
  defaultKeeperhubApiBase?: string;
}

export interface BuiltGateway {
  app: Hono;
  registry: Registry;
}

export async function createApp(config: GatewayConfig): Promise<BuiltGateway> {
  const registry = new Registry(config.registryPath);
  await registry.load();

  const facilitator = createFacilitator(config.facilitatorUrl);
  const audit = config.auditLogPath ? new AuditLog(config.auditLogPath) : undefined;
  const app = new Hono();

  installErrorHandler(app);

  app.get("/healthz", (c) =>
    c.json({
      name: "keepertoll-gateway",
      version: GATEWAY_VERSION,
      status: "ok",
      phase: "phase-2",
      registryEntries: registry.size(),
    }),
  );

  // Public discover surface: agents/dApps fetch this to find paid workflows
  // without holding the admin token. The kh_ key is never echoed.
  app.get("/discover", (c) =>
    c.json({
      gatewayVersion: GATEWAY_VERSION,
      workflows: registry.list().map(({ keeperhubApiKey: _omit, ...rest }) => {
        void _omit;
        return rest;
      }),
    }),
  );

  const admin = buildAdminRoutes({
    registry,
    publicUrl: config.publicUrl,
    ...(audit !== undefined ? { audit } : {}),
  });
  app.use("/admin/*", adminAuth(config.adminToken));
  app.route("/admin", admin);

  mountRunRoutes(app, {
    registry,
    facilitator,
    publicUrl: config.publicUrl,
    ...(audit !== undefined ? { audit } : {}),
    ...(config.defaultMaxWaitMs !== undefined ? { defaultMaxWaitMs: config.defaultMaxWaitMs } : {}),
    ...(config.defaultKeeperhubApiBase !== undefined
      ? { defaultKeeperhubApiBase: config.defaultKeeperhubApiBase }
      : {}),
  });

  return { app, registry };
}

function readConfigFromEnv(): GatewayConfig {
  const adminToken = process.env.GATEWAY_ADMIN_TOKEN;
  if (
    !adminToken ||
    adminToken.trim() === "" ||
    adminToken === "replace_me_with_a_long_random_string"
  ) {
    process.stderr.write(
      "keepertoll-gateway: GATEWAY_ADMIN_TOKEN must be set to a non-default value before the server can start.\n",
    );
    process.exit(78); // EX_CONFIG
  }
  return {
    publicUrl:
      process.env.GATEWAY_PUBLIC_URL ?? `http://localhost:${process.env.GATEWAY_PORT ?? "3030"}`,
    registryPath: process.env.GATEWAY_REGISTRY_PATH ?? "./.keepertoll/registry.json",
    adminToken,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    auditLogPath: process.env.GATEWAY_AUDIT_LOG_PATH ?? "./.keepertoll/audit.log",
    ...(process.env.KEEPERHUB_API_BASE
      ? { defaultKeeperhubApiBase: process.env.KEEPERHUB_API_BASE }
      : {}),
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const config = readConfigFromEnv();
  try {
    const { app: built, registry } = await createApp(config);
    const port = Number.parseInt(process.env.GATEWAY_PORT ?? "3030", 10);
    serve({ fetch: built.fetch, port }, ({ port: bound }) => {
      log.info("keepertoll-gateway listening", {
        url: `http://localhost:${bound}`,
        registryEntries: registry.size(),
        registryPath: config.registryPath,
        facilitator: config.facilitatorUrl,
      });
    });
  } catch (err: unknown) {
    process.stderr.write(
      `keepertoll-gateway: failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
