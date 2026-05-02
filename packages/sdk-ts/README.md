# `@keepertoll/client`

TypeScript SDK for calling x402-paid KeeperHub workflows through a keepertoll
gateway. Handles wallet signing, x402 payment retry, budget tracking, and
execution polling — so an agent can call a paid workflow with one method.

> **Status: Phase 1 stub.** Surface only; real behaviour lands in Phase 3.

## Install (after publish)

```bash
pnpm add @keepertoll/client viem
```

## Sketch (planned API)

```ts
import { KeeperHubClient } from "@keepertoll/client";

const client = new KeeperHubClient({ gatewayUrl: "https://gw.example.com" });
// Phase 3: client.run({ workflowId, input, wallet, budgetUsd })
```
