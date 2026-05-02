# keepertoll

Developer toolkit that turns KeeperHub workflows into x402-paid HTTP endpoints.

> **Status: bootstrap.** This README is a stub. Real documentation lands in Phase 6
> per `CLAUDE.md`. Until then: read `CLAUDE.md` for what we're building, `RECON.md`
> for the verified facts about KeeperHub and x402, and `RESOURCES.md` for canonical
> external links.

## Packages

| Package | Description |
|---|---|
| [`packages/cli`](packages/cli) | `keeperhub-publish` — CLI for workflow authors to publish a KeeperHub workflow as a paid x402 endpoint. |
| [`packages/sdk-ts`](packages/sdk-ts) | `@keepertoll/client` — TypeScript SDK for callers (agents, dApps, scripts). |
| [`packages/sdk-py`](packages/sdk-py) | `keepertoll` — Python SDK, parity with the TypeScript SDK. |
| [`packages/gateway`](packages/gateway) | x402 gateway server. Validates payments, proxies to KeeperHub's `execute_workflow`. |
| [`packages/examples/reference-workflow`](packages/examples/reference-workflow) | KeeperHub workflow JSON used in the demo. |
| [`packages/examples/reference-agent`](packages/examples/reference-agent) | TypeScript agent that uses the SDK to call the reference workflow. |

## Local development

```bash
pnpm install
pnpm run check      # typecheck all TypeScript packages
pnpm run lint       # Biome lint + format check
```

Python SDK has its own check:

```bash
cd packages/sdk-py
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
ruff check src && pyright src
```

## License

MIT.
