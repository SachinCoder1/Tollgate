/**
 * keepertoll — 60-second quickstart.
 *
 * Pays $0.02 USDC on Base Sepolia and calls a real KeeperHub workflow through
 * the public keepertoll gateway. End-to-end this exercises:
 *
 *   discover → x402 402 challenge → EIP-3009 sign → facilitator settle →
 *   KeeperHub execute → result
 *
 * No KeeperHub account required for the caller — the workflow is published
 * by us. You only need a Base Sepolia EOA with a few cents of USDC.
 *
 * To run:
 *
 *   git clone https://github.com/<org>/keepertoll
 *   cd keepertoll && pnpm install
 *   pnpm --filter @keepertoll/quickstart start
 */

import { KeeperHubClient } from "@keepertoll/client";

type Hex = `0x${string}`;

// ── Config ─────────────────────────────────────────────────────────────────────
//
// These three constants are the only thing you may need to change. The
// `GATEWAY_URL` and `WORKFLOW_ID` are pre-filled with our hosted demo. The
// `PRIVATE_KEY` is the only thing you must fund.
//
// To fund the included throwaway key:
//   1. Get Base Sepolia ETH:  https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
//   2. Get Base Sepolia USDC: https://faucet.circle.com/  (chain: Base Sepolia)
//   3. Send both to the address printed by this script on first run.
//
// You only need ~0.10 USDC + ~$0.001 worth of ETH — call it twice and the key
// is empty. That's intentional: this key is throwaway, do not put real funds.

const GATEWAY_URL = process.env.QUICKSTART_GATEWAY_URL ?? "https://keepertoll-gateway.fly.dev";
const WORKFLOW_ID = process.env.QUICKSTART_WORKFLOW_ID ?? "wf_REPLACE_WITH_PUBLISHED_ID";

// IMPORTANT: throwaway test wallet. Do NOT put a key holding real funds here.
// If $QUICKSTART_PRIVATE_KEY is unset we generate + print a fresh one so you
// know exactly what you're funding.
const PRIVATE_KEY: Hex =
  (process.env.QUICKSTART_PRIVATE_KEY as Hex | undefined) ??
  ("0x0000000000000000000000000000000000000000000000000000000000000001" as Hex);

// ── Run ────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  process.stdout.write(`gateway:    ${GATEWAY_URL}\n`);
  process.stdout.write(`workflow:   ${WORKFLOW_ID}\n\n`);

  if (PRIVATE_KEY.endsWith("0001")) {
    process.stderr.write(
      "✗ QUICKSTART_PRIVATE_KEY not set.\n" +
        "  Generate a throwaway key, fund it (faucets in src/quickstart.ts), then:\n" +
        "    QUICKSTART_PRIVATE_KEY=0x… pnpm --filter @keepertoll/quickstart start\n",
    );
    return 2;
  }

  const client = new KeeperHubClient({
    gatewayUrl: GATEWAY_URL,
    privateKey: PRIVATE_KEY,
    chain: "base-sepolia",
    maxPaymentAtomic: 50_000n, // 0.05 USDC ceiling per call
  });

  // Discover what's on offer.
  const workflows = await client.discover();
  if (workflows.length === 0) {
    process.stderr.write(`✗ no workflows registered on ${GATEWAY_URL}.\n`);
    return 1;
  }
  process.stdout.write("→ DISCOVER:\n");
  for (const wf of workflows) {
    process.stdout.write(
      `    ${wf.workflowId}  ${wf.price} ${wf.currency}  ${wf.description ?? ""}\n`,
    );
  }
  process.stdout.write("\n");

  // Pay + call. Sample input: WETH on Base — a known-safe token.
  const targetWorkflow = workflows.find((w) => w.workflowId === WORKFLOW_ID) ?? workflows[0];
  if (!targetWorkflow) {
    process.stderr.write("✗ no workflows available\n");
    return 1;
  }
  process.stdout.write(
    `→ PAY ${targetWorkflow.price} ${targetWorkflow.currency} → CALL ${targetWorkflow.workflowId}\n`,
  );
  const result = await client.run({
    workflowId: targetWorkflow.workflowId,
    input: { tokenAddress: "0x4200000000000000000000000000000000000006", chain: "base" },
    wait: true,
    maxWaitMs: 25_000,
  });

  process.stdout.write(`\n→ RESULT (${result.status}):\n`);
  if (result.status === "success") {
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  } else if (result.status === "pending") {
    process.stdout.write(`    pending — poll ${result.statusUrl}\n`);
  } else {
    process.stdout.write(`    ${result.status}: ${result.error}\n`);
  }
  process.stdout.write(
    `\n→ PAYMENT  payer=${result.payment.payer ?? "?"}  tx=${result.payment.txHash ?? "?"}  network=${result.payment.network}\n`,
  );
  process.stdout.write(
    `→ TOTAL SPEND $${client.totalSpentUsdc} across ${client.callsPaid} call(s)\n`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(
      `\n✗ quickstart failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
