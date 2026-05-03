/**
 * Wrapper around the x402 hosted-facilitator HTTP client. Coinbase's
 * facilitator at https://x402.org/facilitator does the on-chain verify and
 * settle so the gateway never touches RPC.
 *
 * We thinly wrap `useFacilitator` from `x402/verify` to (a) capture the URL
 * once at boot and (b) pin a small typed surface our handler uses.
 */

import type {
  FacilitatorConfig,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "x402/types";
import { useFacilitator } from "x402/verify";

import { PaymentValidationError, SettlementError } from "../errors.js";

export interface FacilitatorClient {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<void>;
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{ txHash?: string; payer?: string; raw: unknown }>;
}

export function createFacilitator(url: string): FacilitatorClient {
  // useFacilitator's signature requires a Resource-typed url. The cast keeps us
  // from leaking the brand into the rest of the code.
  const cfg = { url } as unknown as FacilitatorConfig;
  const inner = useFacilitator(cfg);

  return {
    async verify(payload, requirements) {
      let result: VerifyResponse;
      try {
        result = await inner.verify(payload, requirements);
      } catch (err: unknown) {
        throw new PaymentValidationError(
          `facilitator verify call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!result.isValid) {
        throw new PaymentValidationError(result.invalidReason ?? "facilitator rejected payment", {
          payer: result.payer,
        });
      }
    },

    async settle(payload, requirements) {
      let result: SettleResponse;
      try {
        result = await inner.settle(payload, requirements);
      } catch (err: unknown) {
        throw new SettlementError(
          `facilitator settle call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!result.success) {
        throw new SettlementError(result.errorReason ?? "facilitator failed to settle", {
          payer: result.payer,
        });
      }
      return {
        ...(result.transaction !== undefined ? { txHash: result.transaction } : {}),
        ...(result.payer !== undefined ? { payer: result.payer } : {}),
        raw: result,
      };
    },
  };
}
