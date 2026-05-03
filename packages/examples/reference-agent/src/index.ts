/**
 * Reference agent — proves the marketplace pattern.
 *
 * Narrative:  "Should I swap N USDC for token Y on Base?"
 *   1. DISCOVER   — list paid workflows on the gateway
 *   2. PAY+CALL A — StablecoinPriceCheck($0.03)  → "is USDC at peg?"
 *   3. PAY+CALL B — TokenSafetyCheck($0.02)      → "is token Y safe?"
 *   4. COMPOSE    — yes / wait / no
 *
 * Modes:
 *   - real     — needs AGENT_PRIVATE_KEY (a Base Sepolia EOA with USDC + ETH)
 *   - simulate — no key needed; prints the same markers without paying
 *                (useful for screenshots / demos without funded wallets)
 *
 * Workflow id resolution:
 *   - explicit:  $WORKFLOW_TOKEN_SAFETY_ID and $WORKFLOW_STABLECOIN_PRICE_ID
 *   - implicit:  first discovered workflow whose description matches the relevant
 *                substring (case-insensitive)
 */

import { type DiscoveredWorkflow, KeeperHubClient, type RunResult } from "@keepertoll/client";
import chalk from "chalk";
import type { Hex } from "viem";

const env = process.env;

const SCENARIO = {
  amountUsdc: env.SCENARIO_AMOUNT_USDC ?? "100",
  stablecoin: env.SCENARIO_STABLECOIN ?? "USDC",
  tokenAddress: env.SCENARIO_TOKEN_ADDRESS ?? "0x4200000000000000000000000000000000000006", // WETH on Base
  chain: env.SCENARIO_CHAIN ?? "base",
};

const GATEWAY_URL = env.GATEWAY_PUBLIC_URL ?? "http://localhost:3030";
const AGENT_PRIVATE_KEY = env.AGENT_PRIVATE_KEY as Hex | undefined;
const SIMULATE = env.SIMULATE === "1" || env.SIMULATE === "true";
const TOKEN_SAFETY_ID = env.WORKFLOW_TOKEN_SAFETY_ID;
const PRICE_CHECK_ID = env.WORKFLOW_STABLECOIN_PRICE_ID;

interface SafetyOutput {
  risk: "low" | "medium" | "high";
  recommendation: string;
  symbol?: string | null;
  signals?: Record<string, boolean>;
}

interface PriceOutput {
  median: number | null;
  maxDeviationPct: number;
  confidence: "high" | "medium" | "low";
  anomaly: boolean;
}

const m = {
  discover: chalk.bold.cyan("[DISCOVER]"),
  pay: (price: string) => chalk.bold.yellow(`[PAY $${price}]`),
  call: (name: string) => chalk.bold.blue(`[CALL ${name}]`),
  result: chalk.bold.green("[RESULT]"),
  compose: chalk.bold.magenta("[COMPOSED ANSWER]"),
  total: (spend: string) => chalk.bold.white(`[TOTAL SPEND $${spend}]`),
  sim: chalk.dim("(simulated — no AGENT_PRIVATE_KEY)"),
  ok: chalk.green("✓"),
  warn: chalk.yellow("•"),
  bad: chalk.red("✗"),
};

async function main(): Promise<number> {
  printIntro();

  const useSimulate = SIMULATE || !AGENT_PRIVATE_KEY;
  if (useSimulate && !SIMULATE) {
    process.stdout.write(
      `${chalk.yellow("note")}: AGENT_PRIVATE_KEY not set — falling back to simulate mode.\n      set AGENT_PRIVATE_KEY (Base Sepolia EOA with USDC + ETH) to run for real.\n\n`,
    );
  }

  const client = new KeeperHubClient({
    gatewayUrl: GATEWAY_URL,
    ...(AGENT_PRIVATE_KEY && !useSimulate ? { privateKey: AGENT_PRIVATE_KEY } : {}),
    chain: "base-sepolia",
    maxPaymentAtomic: 50_000n, // 0.05 USDC ceiling per call
  });

  // 1. DISCOVER
  process.stdout.write(`${m.discover} GET ${GATEWAY_URL}/discover\n`);
  let workflows: DiscoveredWorkflow[];
  try {
    workflows = await client.discover();
  } catch (err: unknown) {
    process.stderr.write(
      `${m.bad} discover failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.stderr.write(`is the gateway running? GATEWAY_PUBLIC_URL=${GATEWAY_URL}\n`);
    return 1;
  }
  if (workflows.length === 0) {
    process.stderr.write(
      `${m.bad} no workflows registered on the gateway. Publish two before running.\n`,
    );
    return 1;
  }
  process.stdout.write(`${m.ok} ${workflows.length} workflow(s) discovered:\n`);
  for (const wf of workflows) {
    process.stdout.write(
      `   ${chalk.cyan(wf.workflowId)}  ${wf.price} ${wf.currency} on ${wf.network}  — ${wf.description ?? "(no description)"}\n`,
    );
  }
  process.stdout.write("\n");

  const priceWf = pickWorkflow(workflows, PRICE_CHECK_ID, ["price", "stablecoin", "depeg"]);
  const safetyWf = pickWorkflow(workflows, TOKEN_SAFETY_ID, ["safety", "token", "allowlist"]);
  if (!priceWf || !safetyWf) {
    if (!priceWf)
      process.stderr.write(
        `${m.bad} could not pick a stablecoin price workflow. Set WORKFLOW_STABLECOIN_PRICE_ID.\n`,
      );
    if (!safetyWf)
      process.stderr.write(
        `${m.bad} could not pick a token safety workflow. Set WORKFLOW_TOKEN_SAFETY_ID.\n`,
      );
    return 1;
  }

  // 2. PAY + CALL — StablecoinPriceCheck
  process.stdout.write(
    `${m.pay(priceWf.price)} ${m.call(priceWf.workflowId)} input=${JSON.stringify({ stablecoin: SCENARIO.stablecoin, chain: SCENARIO.chain })} ${useSimulate ? m.sim : ""}\n`,
  );
  const priceResult = await runOrSimulate<PriceOutput>(
    client,
    priceWf,
    {
      stablecoin: SCENARIO.stablecoin,
      chain: SCENARIO.chain,
    },
    useSimulate,
    fakePriceOutput(SCENARIO.stablecoin),
  );
  printRunResult(priceResult);

  // 3. PAY + CALL — TokenSafetyCheck
  process.stdout.write(
    `${m.pay(safetyWf.price)} ${m.call(safetyWf.workflowId)} input=${JSON.stringify({ tokenAddress: SCENARIO.tokenAddress, chain: SCENARIO.chain })} ${useSimulate ? m.sim : ""}\n`,
  );
  const safetyResult = await runOrSimulate<SafetyOutput>(
    client,
    safetyWf,
    {
      tokenAddress: SCENARIO.tokenAddress,
      chain: SCENARIO.chain,
    },
    useSimulate,
    fakeSafetyOutput(SCENARIO.tokenAddress),
  );
  printRunResult(safetyResult);

  // 4. COMPOSE
  const composed = compose(SCENARIO, priceResult.output, safetyResult.output);
  process.stdout.write(`\n${m.compose} ${composed.icon} ${composed.text}\n\n`);

  // 5. TOTAL SPEND
  const totalUsd = useSimulate ? simulatedSpend(priceWf, safetyWf) : client.totalSpentUsdc;
  process.stdout.write(
    `${m.total(totalUsd)} ${client.callsPaid || (useSimulate ? 2 : 0)} paid call(s) ${useSimulate ? m.sim : ""}\n`,
  );

  return 0;
}

function pickWorkflow(
  list: DiscoveredWorkflow[],
  explicitId: string | undefined,
  hintWords: string[],
): DiscoveredWorkflow | undefined {
  if (explicitId) return list.find((w) => w.workflowId === explicitId);
  const lower = (s: string | undefined) => (s ?? "").toLowerCase();
  return list.find((w) => hintWords.some((h) => lower(w.description).includes(h)));
}

async function runOrSimulate<T>(
  client: KeeperHubClient,
  wf: DiscoveredWorkflow,
  input: unknown,
  simulate: boolean,
  fakeOutput: T,
): Promise<{ output: T; payment?: { txHash?: string; payer?: string; network: string } }> {
  if (simulate) {
    return {
      output: fakeOutput,
      payment: { txHash: "0xsimulated", payer: "0xsimulated", network: wf.network },
    };
  }
  const result = (await client.run<T>({
    workflowId: wf.workflowId,
    input,
    wait: true,
    maxWaitMs: 90_000,
  })) as RunResult<T>;
  if (result.status === "success") {
    return { output: result.output, payment: result.payment };
  }
  if (result.status === "pending") {
    // Gateway's pollUntilTerminal hit maxWaitMs without seeing a terminal
    // KH status. Payment already settled on-chain (settle runs before the
    // poll). Caller can poll statusUrl manually to get the eventual result.
    throw new Error(
      `workflow ${wf.workflowId} still pending after 90s; payment was taken. ` +
        `Poll ${result.statusUrl} for the result. ` +
        `If this happens repeatedly, KeeperHub is slow — bump maxWaitMs again.`,
    );
  }
  throw new Error(`workflow ${wf.workflowId} ${result.status}: ${result.error}`);
}

function printRunResult(r: {
  output: unknown;
  payment?: { txHash?: string; network: string };
}): void {
  const tx = r.payment?.txHash ? `  tx=${chalk.dim(r.payment.txHash)}` : "";
  process.stdout.write(`${m.result} ${JSON.stringify(r.output)}${tx}\n\n`);
}

function compose(
  scenario: typeof SCENARIO,
  priceRaw: PriceOutput | null,
  safetyRaw: SafetyOutput | null,
): { icon: string; text: string } {
  // KH workflows can return null while they're being built up (no Output
  // Mapping wired). Don't crash the demo — degrade to "inconclusive".
  if (priceRaw === null || safetyRaw === null) {
    return {
      icon: m.warn,
      text: `Inconclusive — one of the workflows returned no output. Check the KeeperHub canvas: each workflow needs an Action node connected to the Manual trigger, and the Output Mapping must point at it.`,
    };
  }
  const price: PriceOutput = priceRaw;
  const safety: SafetyOutput = safetyRaw;
  const swap = `swap ${scenario.amountUsdc} ${scenario.stablecoin} for ${safety.symbol ?? "token"} (${scenario.tokenAddress.slice(0, 10)}…) on ${scenario.chain}`;
  if (price.anomaly) {
    return {
      icon: m.bad,
      text: `Wait — ${scenario.stablecoin} is off-peg (median=${price.median}, deviation=${price.maxDeviationPct}%). Don't ${swap} until peg restores.`,
    };
  }
  if (safety.risk === "high") {
    return {
      icon: m.bad,
      text: `Do not ${swap}. ${safety.recommendation}`,
    };
  }
  if (safety.risk === "medium") {
    return {
      icon: m.warn,
      text: `Caution — ${safety.recommendation} ${scenario.stablecoin} is at peg (deviation ${price.maxDeviationPct}%); proceed with smaller test amount first.`,
    };
  }
  return {
    icon: m.ok,
    text: `Yes, ${swap}. ${scenario.stablecoin} at peg (deviation ${price.maxDeviationPct}%, confidence ${price.confidence}); ${safety.recommendation}`,
  };
}

function fakePriceOutput(stablecoin: string): PriceOutput {
  return { median: 1.0001, maxDeviationPct: 0.07, confidence: "high", anomaly: false };
}

function fakeSafetyOutput(_tokenAddress: string): SafetyOutput {
  return {
    risk: "low",
    recommendation: "Safe to interact based on the signals checked.",
    symbol: "WETH",
    signals: {
      in_uniswap_default_list: true,
      has_metadata: true,
      is_proxy: false,
      owner_renounced: true,
    },
  };
}

function simulatedSpend(a: DiscoveredWorkflow, b: DiscoveredWorkflow): string {
  const sum = Number(a.price) + Number(b.price);
  return sum.toFixed(2);
}

function printIntro(): void {
  process.stdout.write(
    `${chalk.bold("keepertoll reference agent")}\n` +
      `${chalk.dim(`scenario: should I ${SCENARIO.amountUsdc} ${SCENARIO.stablecoin} → ${SCENARIO.tokenAddress.slice(0, 10)}… on ${SCENARIO.chain}?`)}\n` +
      `${chalk.dim(`gateway:  ${GATEWAY_URL}`)}\n\n`,
  );
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(
      `\n${m.bad} agent crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
