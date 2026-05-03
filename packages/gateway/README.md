# `@keepertoll/gateway`

Hono-based x402 gateway. Hosts paid HTTP routes that, on receiving a verified x402 payment, invoke a KeeperHub workflow on the registered author's behalf and return the result. Stores its workflow registry as an atomic JSON file (mode `0600`) and an append-only JSONL audit log of every successful paid call.

## Run locally

```bash
cp .env.example .env       # at the repo root; edit GATEWAY_ADMIN_TOKEN
pnpm --filter @keepertoll/gateway dev
# → keepertoll-gateway listening on http://localhost:3030
```

```bash
curl http://localhost:3030/healthz
# → { "name": "keepertoll-gateway", "version": "0.1.0", "status": "ok",
#     "phase": "phase-2", "registryEntries": 0 }
```

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | none | Liveness + registry size. |
| `GET` | `/discover` | none | Public marketplace — list paid workflows + price + payTo. `kh_` keys are never echoed. |
| `POST` | `/admin/workflows` | `Bearer $GATEWAY_ADMIN_TOKEN` | Upsert a workflow into the registry (called by the CLI). |
| `GET` | `/admin/workflows[/:id]` | admin | List / get one. |
| `DELETE` | `/admin/workflows/:id` | admin | Unpublish. |
| `GET` | `/admin/audit?limit=N` | admin | Tail of the JSONL audit log. Used to populate `SUBMISSION.md` "External Adoption". |
| `POST` | `/run/:workflowId` | x402 (`X-PAYMENT`) | The hot path: verify → KeeperHub `execute` → settle. |
| `GET` | `/run/:workflowId` | x402 | Same handler, GET variant for `@x402/fetch` clients. |
| `GET` | `/run/:workflowId/status/:executionId` | none | Free passthrough to KeeperHub `get_execution_status` for polling. |

## Sync vs async

- Default: returns `{ status: "pending", executionId, statusUrl }` immediately after KeeperHub kickoff.
- `?wait=true&maxWaitMs=30000`: gateway polls KeeperHub status until terminal or timeout, returns `{ status: "success", output, durationMs }`.

The async default keeps HTTP timeouts short and avoids client retries that would re-pay. Sync mode is opt-in for short workflows.

## Fail-closed ordering

1. Verify payment via facilitator.
2. Call KeeperHub `execute`. **If this fails, return 502 and do NOT settle** — the caller's EIP-3009 authorization expires unspent.
3. On KeeperHub 2xx, ask the facilitator to settle.
4. If settle fails, still return the workflow result with an `X-Settlement-Error` response header.

The verify-then-execute-then-settle ordering is the most important property of this code path. Tests in [`tests/handler.test.ts`](tests/handler.test.ts) lock it down.

## Configuration

All from env (see [`.env.example`](../../.env.example) at the repo root). Refuses to start without `GATEWAY_ADMIN_TOKEN`.

| Var | Default |
|---|---|
| `GATEWAY_PORT` | `3030` |
| `GATEWAY_PUBLIC_URL` | `http://localhost:$GATEWAY_PORT` |
| `GATEWAY_REGISTRY_PATH` | `./.keepertoll/registry.json` |
| `GATEWAY_AUDIT_LOG_PATH` | `./.keepertoll/audit.log` |
| `GATEWAY_ADMIN_TOKEN` | required, no default |
| `KEEPERHUB_API_BASE` | `https://app.keeperhub.com/api` |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` |
| `LOG_LEVEL` | `info` |

## Test

```bash
pnpm --filter @keepertoll/gateway run test     # vitest, ~29 tests
```

Production deploy (one Dockerfile, fly.io / render / any container host with a persistent volume): see [`DEPLOY.md`](../../DEPLOY.md).
