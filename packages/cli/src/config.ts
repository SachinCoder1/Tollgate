/**
 * Resolve env + flag values into the typed config each command consumes.
 * Surfaces missing/invalid input as typed errors with friendly messages.
 */

import {
  InvalidAddressError,
  InvalidChainError,
  InvalidPriceError,
  InvalidWorkflowIdError,
  MissingAdminTokenError,
  MissingApiKeyError,
  MissingPayToError,
} from "./errors.js";

export const SUPPORTED_CHAINS = ["base-sepolia", "base"] as const;
export type Chain = (typeof SUPPORTED_CHAINS)[number];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface PublishConfig {
  workflowId: string;
  price: string;
  currency: "USDC";
  chain: Chain;
  payTo: `0x${string}`;
  description?: string;
  gatewayUrl: string;
  adminToken: string;
  keeperhubApiKey: string;
  keeperhubApiBase: string;
  dryRun: boolean;
  json: boolean;
  skipValidation: boolean;
  verbose: boolean;
}

export interface ManageConfig {
  gatewayUrl: string;
  adminToken: string;
  json: boolean;
  verbose: boolean;
}

export interface PublishFlags {
  price: string;
  currency?: string;
  chain?: string;
  payTo?: string;
  description?: string;
  gatewayUrl?: string;
  adminToken?: string;
  keeperhubApiKey?: string;
  keeperhubApiBase?: string;
  dryRun?: boolean;
  json?: boolean;
  skipValidation?: boolean;
  verbose?: boolean;
}

export interface ManageFlags {
  gatewayUrl?: string;
  adminToken?: string;
  json?: boolean;
  verbose?: boolean;
}

const DEFAULTS = {
  gatewayUrl: "http://localhost:3030",
  keeperhubApiBase: "https://app.keeperhub.com/api",
};

export function resolvePublish(workflowId: string, flags: PublishFlags): PublishConfig {
  const wfId = validateWorkflowId(workflowId);
  const price = validatePrice(flags.price);
  const currency = (flags.currency ?? "USDC").toUpperCase();
  if (currency !== "USDC") {
    throw new InvalidChainError(currency, ["USDC"]);
  }
  const chain = validateChain(flags.chain ?? "base-sepolia");
  const payTo = validateAddress("payTo", flags.payTo ?? process.env.X402_PAY_TO);
  const apiKey = flags.keeperhubApiKey ?? process.env.KEEPERHUB_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "kh_replace_me") {
    throw new MissingApiKeyError();
  }
  const adminToken = requireAdminToken(flags.adminToken);
  const gatewayUrl = (
    flags.gatewayUrl ??
    process.env.GATEWAY_PUBLIC_URL ??
    DEFAULTS.gatewayUrl
  ).replace(/\/$/, "");
  const apiBase =
    flags.keeperhubApiBase ?? process.env.KEEPERHUB_API_BASE ?? DEFAULTS.keeperhubApiBase;
  return {
    workflowId: wfId,
    price,
    currency: "USDC",
    chain,
    payTo,
    ...(flags.description !== undefined ? { description: flags.description } : {}),
    gatewayUrl,
    adminToken,
    keeperhubApiKey: apiKey,
    keeperhubApiBase: apiBase,
    dryRun: flags.dryRun === true,
    json: flags.json === true,
    skipValidation: flags.skipValidation === true,
    verbose: flags.verbose === true,
  };
}

export function resolveManage(flags: ManageFlags): ManageConfig {
  const adminToken = requireAdminToken(flags.adminToken);
  const gatewayUrl = (
    flags.gatewayUrl ??
    process.env.GATEWAY_PUBLIC_URL ??
    DEFAULTS.gatewayUrl
  ).replace(/\/$/, "");
  return {
    gatewayUrl,
    adminToken,
    json: flags.json === true,
    verbose: flags.verbose === true,
  };
}

function validateWorkflowId(value: string): string {
  if (!/^(wf_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{16,64})$/u.test(value)) {
    throw new InvalidWorkflowIdError(value);
  }
  return value;
}

function validatePrice(value: string): string {
  if (!/^\d+(\.\d{1,6})?$/u.test(value)) throw new InvalidPriceError(value);
  if (Number(value) <= 0) throw new InvalidPriceError(value);
  return value;
}

function validateChain(value: string): Chain {
  if ((SUPPORTED_CHAINS as readonly string[]).includes(value)) return value as Chain;
  throw new InvalidChainError(value, SUPPORTED_CHAINS);
}

function validateAddress(field: string, value: string | undefined): `0x${string}` {
  if (!value) throw new MissingPayToError();
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new InvalidAddressError(field, value);
  if (value.toLowerCase() === ZERO_ADDRESS) {
    throw new InvalidAddressError(
      field,
      `${value} (zero address — replace the placeholder in your .env)`,
    );
  }
  return value as `0x${string}`;
}

function requireAdminToken(flagValue: string | undefined): string {
  const fromEnv = process.env.GATEWAY_ADMIN_TOKEN;
  const value = flagValue ?? fromEnv;
  if (!value || value.trim() === "" || value === "replace_me_with_a_long_random_string") {
    throw new MissingAdminTokenError();
  }
  return value;
}
