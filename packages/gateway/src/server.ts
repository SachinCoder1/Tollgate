/**
 * keepertoll gateway — Phase 1 hello-world.
 *
 * Listens on `GATEWAY_PORT` (default 3030) and serves a single `/healthz`
 * route. Real x402 routes (`/run/:workflowId`) land in Phase 2.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { GATEWAY_VERSION } from "./index.js";

export const app = new Hono();

app.get("/healthz", (c) =>
  c.json({
    name: "keepertoll-gateway",
    version: GATEWAY_VERSION,
    status: "ok",
    phase: "bootstrap",
  }),
);

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const port = Number.parseInt(process.env["GATEWAY_PORT"] ?? "3030", 10);
  serve({ fetch: app.fetch, port }, ({ port: bound }) => {
    process.stdout.write(`keepertoll-gateway listening on http://localhost:${bound}\n`);
  });
}
