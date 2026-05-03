# `@keepertoll/reference-agent`

Reference TypeScript agent. Composes two paid keepertoll workflows into a single recommendation, demonstrating the marketplace pattern: discover → compose paid services → answer.

**Narrative:** *"Should I swap 100 USDC for token Y on Base?"* Calls `StablecoinPriceCheck` (is USDC at peg?) + `TokenSafetyCheck` (is token Y safe?), composes a yes / wait / no recommendation, prints total spend.

## Run

Requires the gateway running with both reference workflows published. See [DEMO.md](../../../DEMO.md) for the full pre-flight.

```bash
# real-mode (needs AGENT_PRIVATE_KEY funded with Base Sepolia ETH + USDC)
GATEWAY_PUBLIC_URL=http://localhost:3030 \
AGENT_PRIVATE_KEY=0x… \
WORKFLOW_TOKEN_SAFETY_ID=wf_… \
WORKFLOW_STABLECOIN_PRICE_ID=wf_… \
pnpm --filter @keepertoll/reference-agent dev

# simulate-mode (no funded wallet, prints same markers with txHash=0xsimulated)
SIMULATE=1 GATEWAY_PUBLIC_URL=http://localhost:3030 \
pnpm --filter @keepertoll/reference-agent dev
```

## Output

The agent prints these chalk-coloured markers in order:

```
[DISCOVER]                                            ← GET /discover
[PAY $0.03] [CALL wf_…] input={...}                   ← StablecoinPriceCheck
[RESULT] {...}
[PAY $0.02] [CALL wf_…] input={...}                   ← TokenSafetyCheck
[RESULT] {...}
[COMPOSED ANSWER] ✓ Yes, swap 100 USDC for WETH …
[TOTAL SPEND $0.05] 2 paid call(s)
```

## Python parity

The same agent lives in Python at [`packages/sdk-py/examples/agent.py`](../../sdk-py/examples/agent.py). Same scenario, same markers, same composition logic.
