/**
 * Shared types and zod schemas for the gateway.
 *
 * Two surfaces live here:
 *
 *   1. Admin API request/response shapes (used by the CLI to register a
 *      workflow with the gateway).
 *   2. Run-route response shapes (used by paying x402 clients).
 *
 * The on-disk registry shape is in `./registry.ts`.
 */

import { z } from "zod";

// x402 supports a fixed set of EVM/SVM networks (see PaymentRequirementsSchema
// in the x402 package). keepertoll v0.1 wires the two we have USDC metadata
// for; other x402-supported networks can be added by extending the table in
// ./x402/challenge.ts.
export const SUPPORTED_X402_NETWORKS = ["base-sepolia", "base"] as const;
export type X402Network = (typeof SUPPORTED_X402_NETWORKS)[number];

export const SUPPORTED_CURRENCIES = ["USDC"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u, "must be a 0x-prefixed 40-char hex address")
  .transform((v) => v as `0x${string}`);

const priceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/u, "must be a decimal with up to 6 fractional digits")
  .refine((v) => Number(v) > 0, { message: "must be > 0" });

// KeeperHub workflow IDs are 21+ char alphanumeric (e.g. ywgf93kk1ft8944s3ax38);
// our earlier `wf_…` convention is also accepted for back-compat with tests.
const workflowIdSchema = z
  .string()
  .regex(
    /^(wf_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{16,64})$/u,
    "must be a KeeperHub workflow id (16+ alphanumeric chars) or wf_… form",
  );

export const RegisterWorkflowRequestSchema = z.object({
  workflowId: workflowIdSchema,
  price: priceSchema,
  currency: z.enum(SUPPORTED_CURRENCIES),
  network: z.enum(SUPPORTED_X402_NETWORKS),
  payTo: addressSchema,
  description: z.string().max(280).optional(),
  keeperhubApiKey: z.string().regex(/^kh_/u, "must look like kh_..."),
  keeperhubApiBase: z.string().url().optional(),
});

export type RegisterWorkflowRequest = z.infer<typeof RegisterWorkflowRequestSchema>;

/** Public shape returned by admin GET endpoints. The kh_ key is redacted. */
export interface RegisteredWorkflow {
  workflowId: string;
  price: string;
  currency: Currency;
  network: X402Network;
  payTo: `0x${string}`;
  description?: string;
  endpointUrl: string;
  registeredAt: string;
  keeperhubApiBase?: string;
}

export interface AdminListResponse {
  workflows: RegisteredWorkflow[];
}

/** Settlement metadata returned to the paying caller. */
export interface SettlementMeta {
  txHash?: string;
  network: X402Network;
  payer?: string;
}

export type RunResponse =
  | {
      status: "pending";
      executionId: string;
      runId?: string;
      statusUrl: string;
      payment: SettlementMeta;
    }
  | {
      status: "success";
      executionId: string;
      runId?: string;
      output: unknown;
      durationMs: number;
      payment: SettlementMeta;
    }
  | {
      status: "error" | "cancelled";
      executionId: string;
      runId?: string;
      error: string;
      payment: SettlementMeta;
    };
