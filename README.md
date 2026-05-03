# tollgate

**Turn any KeeperHub workflow into an x402-paid HTTP endpoint, and call paid workflows from agents in TypeScript or Python with one line.** Built for KeeperHub workflow authors who want to monetize, and for agent developers who want to consume on-chain workflows without writing payment plumbing.

> **Note on naming.** The project name is **tollgate**. The npm workspace packages still use the `@keepertoll/*` scope (kept for hackathon stability — rename to `@tollgate/*` planned in v0.5).

[![CI](https://img.shields.io/badge/ci-typecheck%20%2B%20pytest%20%2B%20vitest-success)](.github/workflows/ci.yml) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Built for ETHGlobal Open Agents](https://img.shields.io/badge/built%20for-ETHGlobal%20Open%20Agents-orange)](https://ethglobal.com/events/openagents)

## Why

KeeperHub markets a marketplace: *"Publish a workflow. Keep the logic private. Earn per call. Callers pay per execution in USDC via x402 or MPP."* The marketing is published. **The developer tooling to make it work isn't.** As of [RECON.md Q1](RECON.md#1-does-keeperhub-already-support-publishing-a-workflow-as-a-paid-x402-callable-endpoint-if-yes-how--endpoint-shape-auth-response-format), KeeperHub's `PUT /api/workflows/{id}/go-live` accepts only `{ name, publicTagIds }` — no price, no payTo, no x402 config — and the open-source `KeeperHub/keeperhub` repo has zero hits for `x402` / `MPP` / `paid` / `pricing`. The producer-side bridge is missing.

tollgate ships that bridge. A workflow author runs one CLI command and gets back a working x402-paid endpoint URL. An agent runs five lines of SDK and gets back a paid-and-executed workflow result. The two reference workflows we built (`TokenSafetyCheck` $0.02 and `StablecoinPriceCheck` $0.03) are real things an agent would pay for, not toys. The whole repo is sized to be **mergeable into KeeperHub's official tooling** on May 7, 2026 — that was the design constraint.

## What's in here

| Package | What it does |
|---|---|
| [`packages/cli`](packages/cli) | `keeperhub-publish` — workflow author's CLI |
| [`packages/gateway`](packages/gateway) | Hono server that hosts x402-paid routes and proxies to KeeperHub |
| [`packages/sdk-ts`](packages/sdk-ts) | `@keepertoll/client` — TypeScript SDK for callers |
| [`packages/sdk-py`](packages/sdk-py) | `keepertoll` — Python SDK, full API parity |
| [`packages/examples/quickstart`](packages/examples/quickstart) | One-file pay-and-call in 60 seconds |
| [`packages/examples/reference-agent`](packages/examples/reference-agent) | TypeScript agent that composes two paid workflows |
| [`packages/examples/reference-workflow`](packages/examples/reference-workflow) | Two production-quality workflow recipes (TokenSafetyCheck + StablecoinPriceCheck) |

## Architecture

![architecture](docs/architecture.png)

Five vertical lanes: **author** runs the CLI; **caller** runs an agent; **gateway** is our code; **facilitator** is Coinbase's hosted x402 service; **KeeperHub** is the workflow runtime. Three arrow colours: green for publish/control, orange for the x402 payment dance, blue for execution. The system fails closed: a KeeperHub error before facilitator settle means the caller is **never charged for nothing**.

Full layout spec + render instructions: [`docs/architecture.md`](docs/architecture.md).

## Quickstart — for workflow authors (3 commands)

You need a KeeperHub `kh_…` API key, a Base Sepolia EOA you control, and the gateway running locally or hosted (see [`DEPLOY.md`](DEPLOY.md) for one-line fly.io deploy).

```bash
# 1. install + globally link the CLI
pnpm install && pnpm --filter @keepertoll/cli link --global

# 2. point at your gateway + your key + your payout address
export GATEWAY_PUBLIC_URL=https://your-gateway.fly.dev \
       GATEWAY_ADMIN_TOKEN=<random-32-bytes> \
       KEEPERHUB_API_KEY=kh_your_key \
       X402_PAY_TO=0xYourEOA

# 3. publish (one workflow, one command)
keeperhub-publish wf_yourId --price 0.02 --currency USDC --chain base-sepolia
# → ✓ Endpoint live: POST https://your-gateway.fly.dev/run/wf_yourId
```

That's it. Earnings flow to your `payTo` EOA per call.

## Quickstart — for callers (5 lines of code)

The TypeScript SDK on a paid endpoint, with auto-pay + budget cap + retry handled for you:

```ts
import { KeeperHubClient } from "@keepertoll/client";

const client = new KeeperHubClient({
  gatewayUrl: "https://keepertoll-gateway.fly.dev",
  privateKey: process.env.MY_PRIVATE_KEY as `0x${string}`,
  chain: "base-sepolia",
  maxPaymentAtomic: 50_000n, // refuse if a single call exceeds 0.05 USDC
});

const result = await client.run({
  workflowId: "wf_safety",
  input: { tokenAddress: "0x4200000000000000000000000000000000000006" },
  wait: true,
});

console.log(result.output);
console.log(client.totalSpentUsdc, "USDC across", client.callsPaid, "call(s)");
```

Same code in Python via the SDK at parity:

```python
import asyncio
from keepertoll import KeeperHubClient

async def main():
    async with KeeperHubClient(
        gateway_url="https://keepertoll-gateway.fly.dev",
        private_key="0x...",
        chain="base-sepolia",
        max_payment_atomic=50_000,
    ) as client:
        r = await client.run(
            workflow_id="wf_safety",
            input={"tokenAddress": "0x4200000000000000000000000000000000000006"},
            wait=True,
        )
        print(r["output"], "spent", client.total_spent_usdc, "USDC")

asyncio.run(main())
```

A truly stupidly-easy path is [`packages/examples/quickstart`](packages/examples/quickstart) — clone, install, run.

## CLI reference

```
keeperhub-publish <workflowId> [flags]    # default verb when first arg is wf_*
keeperhub-publish publish <workflowId> [flags]
keeperhub-publish status <workflowId> [flags]
keeperhub-publish list [flags]
keeperhub-publish unpublish <workflowId> [--yes] [flags]
```

**Publish flags** (also work on the bare form):

| Flag | Default | Description |
|---|---|---|
| `--price <decimal>` | required | Price per call, e.g. `0.02` |
| `--currency <c>` | `USDC` | v1 supports USDC only |
| `--chain <c>` | `base-sepolia` | Or `base` (mainnet) |
| `--pay-to <0x..>` | env `X402_PAY_TO` | Payout EOA. Zero address rejected. |
| `--description <s>` | — | Shown in the 402 challenge body |
| `--gateway-url <url>` | env `GATEWAY_PUBLIC_URL` | Default `http://localhost:3030` |
| `--admin-token <t>` | env `GATEWAY_ADMIN_TOKEN` | Bearer token for `/admin/*` |
| `--keeperhub-api-key <k>` | env `KEEPERHUB_API_KEY` | `kh_…` org-scoped key |
| `--keeperhub-api-base <url>` | env `KEEPERHUB_API_BASE` | Default `https://app.keeperhub.com/api` |
| `--dry-run` | off | Validate inputs, print summary, no HTTP |
| `--json` | off | Single-line JSON instead of human text |
| `--skip-validation` | off | Skip the KeeperHub ownership precheck |
| `--verbose` | off | Debug stderr |

Exit codes: `0` success · `2` invalid input/env · `3` KeeperHub rejected · `4` gateway unreachable/auth · `5` gateway 4xx (validation/etc.).

## SDK reference

The TypeScript and Python SDKs have identical surface. Python uses snake_case + async-first; TypeScript uses camelCase + Promise-based.

### `KeeperHubClient` constructor

| Option | Type | Default | Notes |
|---|---|---|---|
| `gatewayUrl` / `gateway_url` | `string` | required | The public origin of a keepertoll gateway |
| `privateKey` / `private_key` | `0x${string}` | optional | EOA hex key. Omit for discover-only mode |
| `account` | viem `Account` / eth_account `LocalAccount` | optional | Pre-built signer (alternative to `privateKey`) |
| `chain` | `"base-sepolia" \| "base"` | `"base-sepolia"` | Wallet client chain |
| `maxPaymentAtomic` / `max_payment_atomic` | `bigint` / `int` | `100_000` | Per-call USDC ceiling, atomic units (6 decimals) |

### Methods

| TypeScript | Python | Notes |
|---|---|---|
| `await client.discover()` | `await client.discover()` | Returns `DiscoveredWorkflow[]`. No payment. |
| `await client.getWorkflow(id)` | `await client.get_workflow(id)` | Cached after first `discover()` |
| `await client.run({ workflowId, input?, wait?, maxWaitMs? })` | `await client.run(workflow_id=..., input=None, wait=False, max_wait_ms=None)` | Pay + execute. Returns `RunResult` discriminated union. |
| `client.totalSpentAtomic` | `client.total_spent_atomic` | `bigint` / `int`, accumulates on success |
| `client.callsPaid` | `client.calls_paid` | `int` |
| `client.totalSpentUsdc` | `client.total_spent_usdc` | Human-readable, e.g. `"0.040000"` |
| `client.hasWallet` | `client.has_wallet` | `bool` — false in discover-only mode |

### Error classes (Python)

`NoWalletConfiguredError`, `PaymentExceedsBudgetError`, `WorkflowExecutionError`, `GatewayUnreachableError`, `DiscoverFailedError`, `UnexpectedStatusError` — all descend from `KeepertollSdkError`.

(TypeScript SDK currently throws plain `Error` with the same messages.)

## Reference workflows

The [`packages/examples/reference-workflow/`](packages/examples/reference-workflow/) directory ships two production-quality recipes:

- **TokenSafetyCheck** ($0.02/call) — given an ERC-20 address, returns metadata + risk signals (in Uniswap default list, EIP-1967 proxy, owner renounced) + a `risk: low|medium|high` label and a recommendation. Use case: wallet apps, swap routers, AI agents about to interact with an unknown token.
- **StablecoinPriceCheck** ($0.03/call) — DEX-derived stablecoin price across multiple Uniswap V3 pools with a depeg signal. Use case: DeFi routers, treasury bots, payment processors.

Each workflow ships its `workflow.json` recipe and a `CREATION_STEPS.md` walkthrough for KeeperHub canvas. See [RATIONALE.md](packages/examples/reference-workflow/RATIONALE.md) for why these two over four candidates.

## Reference agent

[`packages/examples/reference-agent`](packages/examples/reference-agent) (TypeScript) and [`packages/sdk-py/examples/agent.py`](packages/sdk-py/examples/agent.py) (Python parity) demonstrate the marketplace pattern: discover → compose two paid workflows → produce a single recommendation. The narrative the demo asks: *"Should I swap 100 USDC for token Y on Base?"* The agent calls `StablecoinPriceCheck` (is USDC at peg?) + `TokenSafetyCheck` (is token Y safe?) and composes a yes/wait/no answer.

Terminal output uses the marker tags `[DISCOVER]`, `[PAY $X]`, `[CALL wf_…]`, `[RESULT]`, `[COMPOSED ANSWER]`, `[TOTAL SPEND $X.XX]`. Run in simulate mode (no funded wallet) by setting `SIMULATE=1`.

## Demo

90 seconds, two terminals side by side. Author publishes both workflows; agent calls both and composes the recommendation; total spend $0.05 lands on Base Sepolia.

Full beat sheet + recovery table: [`DEMO.md`](DEMO.md).

## Deployment

Public-host the gateway in 5 commands on fly.io (the documented path; the same `Dockerfile` works on render / railway / any container host with a persistent volume):

```bash
fly launch --no-deploy --copy-config
fly volumes create keepertoll_data --size 1 --region ord
fly secrets set GATEWAY_ADMIN_TOKEN=$(openssl rand -hex 32) KEEPERHUB_API_KEY=kh_…
fly deploy
fly secrets set GATEWAY_PUBLIC_URL=https://<app>.fly.dev && fly deploy
```

Full runbook: [`DEPLOY.md`](DEPLOY.md).

## Limitations / what's not in v1

- **Two chains, one currency.** `base-sepolia` and `base` only. USDC only. Other x402-supported chains (avalanche, polygon, sei, …) need a row added to the USDC-by-network table — see [CONTRIBUTING.md](CONTRIBUTING.md).
- **`kh_` API keys live in a JSON file on the gateway.** File mode is `0600` and the file is gitignored, but a serious deployment should swap to a secrets manager (Doppler, Vault, fly secrets-as-files). Tracked as a v0.5 follow-up.
- **Workflow ownership precheck is best-effort.** KeeperHub does not document a public `GET /api/workflow/{id}` endpoint (see [FEEDBACK.md KH-DOCS-2](FEEDBACK.md)). The CLI tries `GET /workflow/{id}`; if it 404s, pass `--skip-validation` and let the first paid call validate the workflow exists.
- **No npm publish yet.** Install via `pnpm add github:<org>/keepertoll#path:packages/sdk-ts` (or local workspace link). Hackathon-stage; npm/PyPI publish is a one-day follow-up.
- **No on-chain test in CI.** CI runs unit + integration tests against a locally spawned gateway with mocked x402 facilitator. Real Base Sepolia round-trips are exercised manually before each demo.

## Roadmap

- v0.5 (within 2 weeks of submission): npm + PyPI publish; Cloudflare Workers gateway port (KV-backed registry); secrets-manager option for `kh_` keys; per-org default `payTo`.
- v1.0: production hardening; multi-currency (EURC); MPP scheme alongside x402; collapse the gateway into a thin shim if KeeperHub ships a producer-side x402 publish API (see [FEEDBACK.md FR-1](FEEDBACK.md)); bulk-publish from a `keepertoll.config.toml`.

## Built for

[ETHGlobal Open Agents](https://ethglobal.com/events/openagents) (April 24 – May 6, 2026), targeting the **KeeperHub track Focus Area 2 — Best Integration with KeeperHub (payments / x402)**. See [`SUBMISSION.md`](SUBMISSION.md) for the official submission package and [`FEEDBACK.md`](FEEDBACK.md) for our Builder Feedback Bounty entry.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — build plan, constraints, working agreement
- [`RECON.md`](RECON.md) — verified facts about KeeperHub and x402, Day-0 reconnaissance
- [`RESOURCES.md`](RESOURCES.md) — canonical external links
- [`DEMO.md`](DEMO.md) — 90-second demo script + recovery table
- [`DEPLOY.md`](DEPLOY.md) — public-host runbook
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — outreach playbook
- [`SUBMISSION.md`](SUBMISSION.md) — ETHGlobal submission package
- [`FEEDBACK.md`](FEEDBACK.md) — KeeperHub friction inventory (Builder Feedback Bounty entry)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — coding standards + how to add a chain
- [`docs/architecture.md`](docs/architecture.md) — diagram spec

## License

[MIT](LICENSE).
