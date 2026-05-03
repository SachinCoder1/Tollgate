# `keepertoll` (Python)

Async Python SDK for calling x402-paid KeeperHub workflows. Mirrors the
surface of `@keepertoll/client` (TypeScript).

## Install

```bash
cd packages/sdk-py
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e '.[dev]'
```

(`pip install -e '.[dev]'` works too if you don't have `uv`.)

## Use

```python
import asyncio
from keepertoll import KeeperHubClient

async def main() -> None:
    async with KeeperHubClient(
        gateway_url="http://localhost:3030",
        private_key="0x...",          # omit for discover-only mode
        chain="base-sepolia",
        max_payment_atomic=100_000,    # 0.10 USDC ceiling per call
    ) as client:
        for wf in await client.discover():
            print(wf["workflowId"], wf["price"], wf["currency"])

        result = await client.run(
            workflow_id="wf_demo",
            input={"tokenAddress": "0x4200000000000000000000000000000000000006"},
            wait=True,
            max_wait_ms=25_000,
        )
        print(result)
        print(client.total_spent_usdc, "USDC across", client.calls_paid, "call(s)")

asyncio.run(main())
```

## Errors

All raised exceptions descend from `KeepertollSdkError`. Specifically typed:

- `NoWalletConfiguredError` — `run()` without a private key
- `PaymentExceedsBudgetError` — workflow price exceeds `max_payment_atomic`
- `WorkflowExecutionError` — gateway returned non-2xx after payment
- `GatewayUnreachableError` — network failure
- `DiscoverFailedError` — `GET /discover` returned non-2xx
- `UnexpectedStatusError` — unexpected response shape

## Tests

```bash
.venv/bin/python -m pytest                                 # unit (mocks via respx)
KEEPERTOLL_INTEGRATION=1 .venv/bin/python -m pytest         # +integration test against live gateway
.venv/bin/python -m ruff check src tests examples
.venv/bin/python -m pyright
```

## Reference agent

```bash
SIMULATE=1 GATEWAY_PUBLIC_URL=http://localhost:3030 \
  .venv/bin/python -m examples.agent
```

Mirrors `packages/examples/reference-agent/` from the TS side. Same
discover → pay → call → compose flow with the same `[DISCOVER] [PAY $X] [CALL]
[RESULT] [COMPOSED ANSWER] [TOTAL SPEND $X.XX]` markers.
