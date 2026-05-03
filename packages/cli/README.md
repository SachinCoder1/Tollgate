# `@keepertoll/cli` — `keeperhub-publish`

CLI for KeeperHub workflow authors. One command turns a workflow into an x402-paid HTTP endpoint hosted on the keepertoll gateway.

## Install

```bash
# from a workspace clone
pnpm install
pnpm --filter @keepertoll/cli build
pnpm --filter @keepertoll/cli link --global
which keeperhub-publish
```

## Use

```bash
# 1. set env (or pass each as flags)
export GATEWAY_PUBLIC_URL=https://your-gateway.fly.dev \
       GATEWAY_ADMIN_TOKEN=<random-32-bytes> \
       KEEPERHUB_API_KEY=kh_… \
       X402_PAY_TO=0xYourEOA

# 2. publish a workflow
keeperhub-publish wf_yourId --price 0.02 --currency USDC --chain base-sepolia

# 3. inspect / manage
keeperhub-publish list
keeperhub-publish status wf_yourId
keeperhub-publish unpublish wf_yourId --yes
```

The bare form (`keeperhub-publish wf_xxx --price …`) auto-dispatches to `publish` whenever the first arg matches `wf_*`. The explicit form (`keeperhub-publish publish wf_xxx …`) also works.

## Reference

Full flag table, exit codes, and ownership-precheck behaviour are in the [top-level README](../../README.md#cli-reference). Source: [`src/index.ts`](src/index.ts).

## Test

```bash
pnpm --filter @keepertoll/cli run test     # vitest, ~27 tests
```
