# `keepertoll` (Python)

Python SDK for calling x402-paid KeeperHub workflows. Parity with
`@keepertoll/client` on the TypeScript side.

> **Status: Phase 1 stub.** Surface only; real behaviour lands in Phase 5.

## Local dev

```bash
cd packages/sdk-py
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
ruff check src
pyright src
```

## Sketch (planned API)

```python
from keepertoll import KeeperHubClient, KeeperHubClientOptions

client = KeeperHubClient(KeeperHubClientOptions(gateway_url="http://localhost:3030"))
# Phase 5: client.run(workflow_id=..., input=..., wallet=..., budget_usd=...)
```
