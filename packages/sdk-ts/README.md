# `@keepertoll/client`

Async TypeScript SDK for calling x402-paid KeeperHub workflows through a keepertoll gateway. Handles wallet signing (via `x402-fetch` + viem), per-call budget caps, settlement-receipt parsing, and async/sync polling.

## Install

Until the package lands on npm, install via workspace or direct GitHub:

```bash
# inside the monorepo (recommended for hacking)
pnpm install
pnpm --filter @keepertoll/client build

# from another project (hackathon-style)
pnpm add github:<org>/keepertoll#path:packages/sdk-ts viem
```

## Use

```ts
import { KeeperHubClient } from "@keepertoll/client";

const client = new KeeperHubClient({
  gatewayUrl: "https://keepertoll-gateway.fly.dev",
  privateKey: process.env.MY_PRIVATE_KEY as `0x${string}`,  // omit for discover-only
  chain: "base-sepolia",                                     // or "base"
  maxPaymentAtomic: 50_000n,                                 // refuse if a single call exceeds 0.05 USDC
});

// 1. Discover paid workflows on the gateway (free).
for (const wf of await client.discover()) {
  console.log(wf.workflowId, wf.price, wf.currency, wf.description);
}

// 2. Pay + call. `wait: true` makes the gateway poll until terminal.
const result = await client.run({
  workflowId: "wf_safety",
  input: { tokenAddress: "0x4200000000000000000000000000000000000006" },
  wait: true,
  maxWaitMs: 25_000,
});

if (result.status === "success") console.log(result.output);

// 3. Spend tracking.
console.log(client.totalSpentUsdc, "USDC across", client.callsPaid, "call(s)");
```

## Surface

See the [SDK reference table in the top-level README](../../README.md#sdk-reference) — the TypeScript and Python SDKs have identical surface modulo casing convention.

The discriminated `RunResult` union: `RunPending | RunSuccess<T> | RunFailure`. Switch on `result.status` to narrow.

## Errors

Currently throws plain `Error` with descriptive messages. Typed-class parity with the Python SDK is a v0.5 follow-up.

Exceptions you should catch:

| Cause | Message hint |
|---|---|
| No wallet configured + you called `.run()` | "no wallet configured" |
| Workflow price exceeds `maxPaymentAtomic` | thrown by `x402-fetch`, includes "max value" |
| Gateway returned non-2xx after payment | `run failed (502): ...` |
| Network failure to the gateway | usual `fetch` error |

## Test

The SDK has no tests of its own — the gateway tests cover the wire format, and [`packages/examples/quickstart`](../examples/quickstart) is the integration cover. The Python SDK at [`packages/sdk-py`](../sdk-py) has full unit + integration tests with respx mocks; behaviour is held to parity.
