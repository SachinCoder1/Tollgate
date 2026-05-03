/**
 * Builds x402 PaymentRequirements (the body of a 402 challenge) for a stored
 * workflow. Currently only Base Sepolia is wired with full token metadata —
 * other networks throw at challenge-build time so we never quote a price we
 * cannot accept.
 */

import type { PaymentRequirements } from "x402/types";

import { ValidationError } from "../errors.js";
import type { StoredWorkflow } from "../registry.js";
import type { X402Network } from "../types.js";

interface TokenMeta {
  address: `0x${string}`;
  decimals: number;
  eip712: { name: string; version: string };
}

// USDC token metadata, keyed by x402 network string. Source: USDC docs +
// Coinbase x402 examples; verified for base-sepolia from RESOURCES.md.
const USDC_BY_NETWORK: Partial<Record<X402Network, TokenMeta>> = {
  "base-sepolia": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    eip712: { name: "USDC", version: "2" },
  },
  base: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    eip712: { name: "USD Coin", version: "2" },
  },
};

const DEFAULT_PAYMENT_TIMEOUT_SECONDS = 60;

export interface BuildChallengeArgs {
  workflow: StoredWorkflow;
  /** Fully qualified resource URL (e.g. http://localhost:3030/run/wf_x). */
  resourceUrl: string;
}

export function buildPaymentRequirements({
  workflow,
  resourceUrl,
}: BuildChallengeArgs): PaymentRequirements {
  if (workflow.currency !== "USDC") {
    throw new ValidationError(`unsupported currency: ${workflow.currency}`);
  }
  const token = USDC_BY_NETWORK[workflow.network];
  if (!token) {
    throw new ValidationError(
      `network ${workflow.network} not supported in v0.1; only base-sepolia and base have USDC metadata wired`,
    );
  }
  return {
    scheme: "exact",
    network: workflow.network,
    maxAmountRequired: toAtomic(workflow.price, token.decimals),
    resource: resourceUrl,
    description: workflow.description ?? `KeeperHub workflow ${workflow.workflowId}`,
    mimeType: "application/json",
    payTo: workflow.payTo,
    maxTimeoutSeconds: DEFAULT_PAYMENT_TIMEOUT_SECONDS,
    asset: token.address,
    extra: { name: token.eip712.name, version: token.eip712.version },
  };
}

/** Convert "0.02" + decimals=6 → "20000". Inputs validated by the zod schema. */
export function toAtomic(human: string, decimals: number): string {
  const [whole = "0", fraction = ""] = human.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/u, "");
  return combined === "" ? "0" : combined;
}
