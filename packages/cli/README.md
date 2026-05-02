# `@keepertoll/cli` — `keeperhub-publish`

CLI for KeeperHub workflow authors. One command turns a workflow into an
x402-paid HTTP endpoint hosted on the keepertoll gateway.

> **Status: Phase 1 stub.** Only `--help` and `--version` work. Real subcommands
> land in Phase 2 (Days 2–4 of the build).

## Planned commands

```
keeperhub-publish init       Register a workflow ID + price with the gateway.
keeperhub-publish publish    Open the registered route on the gateway.
keeperhub-publish status     Show the gateway-side state of a workflow.
keeperhub-publish list       List workflows the current author has registered.
keeperhub-publish unpublish  Remove a workflow from the gateway.
```

## Usage (after build)

```bash
pnpm --filter @keepertoll/cli build
node packages/cli/dist/cli.js --help
```

## Dev loop

```bash
pnpm --filter @keepertoll/cli dev -- --help
```
