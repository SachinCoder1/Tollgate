# `@keepertoll/reference-workflow`

Two production-quality KeeperHub workflow recipes used as reference for the demo. Both are publishable as paid x402 endpoints via the keepertoll CLI.

| Workflow | Price | Description | Recipe | Canvas steps |
|---|---|---|---|---|
| **TokenSafetyCheck** | $0.02 | Given an ERC-20 address, returns metadata + risk signals + a `risk: low\|medium\|high` label and a recommendation. | [`token-safety-check/workflow.json`](token-safety-check/workflow.json) | [`token-safety-check/CREATION_STEPS.md`](token-safety-check/CREATION_STEPS.md) |
| **StablecoinPriceCheck** | $0.03 | DEX-derived stablecoin price across multiple Uniswap V3 pools, with a depeg signal. | [`stablecoin-price-check/workflow.json`](stablecoin-price-check/workflow.json) | [`stablecoin-price-check/CREATION_STEPS.md`](stablecoin-price-check/CREATION_STEPS.md) |

Why these two and not other candidates: see [`RATIONALE.md`](RATIONALE.md). Score table for four candidates → pick of two; one paragraph each on demand and alternative-cost.

## Recreate on KeeperHub

The two `workflow.json` files are **recipes** (node + edge specs), not literal KeeperHub canvas exports — RECON Q7 doesn't pin the canvas JSON schema. Each `CREATION_STEPS.md` walks through the canvas builder step-by-step. Anything inferred (e.g. node type names like `evm_read_contract`) is marked at the top of each file; mismatches go into [`FEEDBACK.md`](../../../FEEDBACK.md).

## Publish via the CLI

After creating both workflows on `app.keeperhub.com` and getting their `wf_…` IDs:

```bash
keeperhub-publish $WF_SAFETY_ID --price 0.02 --currency USDC --chain base-sepolia \
  --description "ERC-20 safety report (metadata + Uniswap allowlist + proxy + ownership)"

keeperhub-publish $WF_STABLE_ID --price 0.03 --currency USDC --chain base-sepolia \
  --description "DEX-derived stablecoin price across Uniswap V3 pools (median + depeg signal)"
```

Both workflows are then callable via the SDKs at `POST /run/$WF_…` on the gateway.
