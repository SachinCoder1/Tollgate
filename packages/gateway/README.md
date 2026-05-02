# `@keepertoll/gateway`

x402 gateway server. Hosts paid HTTP routes that, on receiving a verified
x402 payment, invoke a KeeperHub workflow on the registered author's behalf
and return the result.

> **Status: Phase 1 stub.** Only `/healthz` works. x402 middleware and
> KeeperHub proxying land in Phase 2.

## Run locally

```bash
pnpm --filter @keepertoll/gateway dev
# → keepertoll-gateway listening on http://localhost:3030
```

```bash
curl http://localhost:3030/healthz
# {"name":"keepertoll-gateway","version":"0.0.0","status":"ok","phase":"bootstrap"}
```

## Planned routes (Phase 2)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness. |
| `POST` | `/admin/workflows` | Register a workflow + price (called by the CLI). |
| `GET` | `/admin/workflows` | List registered workflows. |
| `DELETE` | `/admin/workflows/:id` | Unregister. |
| `POST` | `/run/:workflowId` | x402-gated execute. Returns either `{ executionId }` (async) or `{ output }` (sync). |
