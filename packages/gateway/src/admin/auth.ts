/**
 * Bearer-token middleware for the gateway's /admin/* surface. The expected
 * token is captured at mount time so each request does a constant-time
 * comparison against the configured value.
 */

import { timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import { AdminAuthError } from "../errors.js";

const PREFIX = "Bearer ";

export function adminAuth(expectedToken: string): MiddlewareHandler {
  if (expectedToken.length === 0) {
    throw new Error("adminAuth: expectedToken is empty");
  }
  const expectedBuf = Buffer.from(expectedToken, "utf8");

  return async (c, next) => {
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header) throw new AdminAuthError("admin_token_required");
    if (!header.startsWith(PREFIX)) throw new AdminAuthError("admin_token_invalid");
    const presented = Buffer.from(header.slice(PREFIX.length), "utf8");
    if (presented.length !== expectedBuf.length) {
      throw new AdminAuthError("admin_token_invalid");
    }
    if (!timingSafeEqual(presented, expectedBuf)) {
      throw new AdminAuthError("admin_token_invalid");
    }
    await next();
  };
}
