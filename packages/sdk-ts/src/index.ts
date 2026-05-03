/**
 * `@tollgate/client` — TypeScript SDK for callers of x402-paid KeeperHub
 * workflows.
 *
 * Usage:
 *
 *   const client = new KeeperHubClient({
 *     gatewayUrl: "http://localhost:3030",
 *     privateKey: "0x..." as Hex,        // omit to use discover-only mode
 *     chain: "base-sepolia",
 *     maxPaymentAtomic: 100_000n,         // 0.10 USDC ceiling per call
 *   });
 *
 *   const list = await client.discover();
 *   const result = await client.run({ workflowId: "wf_demo", input: { ... } });
 *
 *   console.log(result.output);
 *   console.log("paid", client.totalSpentAtomic, "atomic USDC over", client.callsPaid, "calls");
 */

import { http, type Account, type Hex, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

export type SupportedChain = "base-sepolia" | "base";

const CHAIN_BY_NAME = {
  "base-sepolia": baseSepolia,
  base,
} as const;

const PRICE_DECIMALS = 6; // USDC

export interface DiscoveredWorkflow {
  workflowId: string;
  price: string;
  currency: string;
  network: string;
  payTo: string;
  description?: string;
  endpointUrl: string;
  registeredAt: string;
}

export interface RunPayment {
  txHash?: string;
  payer?: string;
  network: string;
}

export type RunResult<T = unknown> =
  | {
      status: "pending";
      executionId: string;
      runId?: string;
      statusUrl: string;
      payment: RunPayment;
    }
  | {
      status: "success";
      executionId: string;
      runId?: string;
      output: T;
      durationMs: number;
      payment: RunPayment;
    }
  | {
      status: "error" | "cancelled";
      executionId: string;
      runId?: string;
      error: string;
      payment: RunPayment;
    };

export interface KeeperHubClientOptions {
  /** Base URL of a keepertoll gateway, e.g. `http://localhost:3030`. */
  gatewayUrl: string;
  /** EOA private key for signing x402 payments. Omit for discover-only mode. */
  privateKey?: Hex;
  /** Pre-built viem account (alternative to `privateKey`). */
  account?: Account;
  /** Chain for the wallet client. Default `base-sepolia`. */
  chain?: SupportedChain;
  /** Per-call ceiling in atomic USDC units (6 decimals). Default 100_000n = 0.10 USDC. */
  maxPaymentAtomic?: bigint;
}

export interface RunArgs {
  workflowId: string;
  input?: unknown;
  /** Ask the gateway to poll until terminal and return the final output. */
  wait?: boolean;
  /** Max time the gateway should poll for. Only used when `wait: true`. */
  maxWaitMs?: number;
}

export class KeeperHubClient {
  readonly gatewayUrl: string;
  readonly hasWallet: boolean;
  readonly chain: SupportedChain;
  /** Sum of prices paid (atomic USDC) across successful run() calls. */
  totalSpentAtomic = 0n;
  /** Count of successful paid run() calls. */
  callsPaid = 0;

  private readonly payFetch: typeof globalThis.fetch | undefined;
  private discoverCache: Map<string, DiscoveredWorkflow> | undefined;

  constructor(opts: KeeperHubClientOptions) {
    this.gatewayUrl = opts.gatewayUrl.replace(/\/$/u, "");
    this.chain = opts.chain ?? "base-sepolia";

    const account =
      opts.account ?? (opts.privateKey ? privateKeyToAccount(opts.privateKey) : undefined);
    if (account) {
      const chain = CHAIN_BY_NAME[this.chain];
      // viem WalletClient is the canonical Signer x402-fetch expects. The
      // `as never` skips the structural-but-branded type check.
      const wallet = createWalletClient({ account, chain, transport: http() });
      const max = opts.maxPaymentAtomic ?? 100_000n;
      this.payFetch = wrapFetchWithPayment(globalThis.fetch, wallet as never, max);
      this.hasWallet = true;
    } else {
      this.hasWallet = false;
    }
  }

  /** Fetch all workflows registered on the gateway (no payment required). */
  async discover(): Promise<DiscoveredWorkflow[]> {
    const res = await fetch(`${this.gatewayUrl}/discover`);
    if (!res.ok) throw new Error(`discover failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { workflows: DiscoveredWorkflow[] };
    this.discoverCache = new Map(body.workflows.map((w) => [w.workflowId, w]));
    return body.workflows;
  }

  /** Lookup a single workflow. Cached after first discover() call. */
  async getWorkflow(workflowId: string): Promise<DiscoveredWorkflow | undefined> {
    if (!this.discoverCache) await this.discover();
    return this.discoverCache?.get(workflowId);
  }

  /**
   * Pay the gateway and call a workflow. Throws if no wallet was configured
   * or if x402-fetch refuses (e.g. price exceeds maxPaymentAtomic).
   */
  async run<T = unknown>(args: RunArgs): Promise<RunResult<T>> {
    if (!this.payFetch) {
      throw new Error(
        "KeeperHubClient: no wallet configured. Pass privateKey or account to enable run().",
      );
    }
    const url = new URL(`${this.gatewayUrl}/run/${encodeURIComponent(args.workflowId)}`);
    if (args.wait) {
      url.searchParams.set("wait", "true");
      if (args.maxWaitMs !== undefined) url.searchParams.set("maxWaitMs", String(args.maxWaitMs));
    }

    const res = await this.payFetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args.input ?? {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`run failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const body = (await res.json()) as RunResult<T>;

    // Track spend. We need the workflow's price; look it up via discover.
    const wf = await this.getWorkflow(args.workflowId);
    if (wf) {
      this.totalSpentAtomic += parseUsdcAtomic(wf.price);
      this.callsPaid += 1;
    }

    return body;
  }

  /** Human-readable total spend, e.g. "0.040000". */
  get totalSpentUsdc(): string {
    return formatAtomic(this.totalSpentAtomic, PRICE_DECIMALS);
  }
}

function parseUsdcAtomic(human: string): bigint {
  const [whole = "0", fraction = ""] = human.split(".");
  const padded = (fraction + "0".repeat(PRICE_DECIMALS)).slice(0, PRICE_DECIMALS);
  return BigInt(`${whole}${padded}`);
}

function formatAtomic(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const frac = (value % divisor).toString().padStart(decimals, "0");
  return `${whole.toString()}.${frac}`;
}
