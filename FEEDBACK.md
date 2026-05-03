# Feedback for KeeperHub (and a little for x402)

I built **tollgate** — an x402 paywall in front of `POST /api/workflow/{id}/execute` — over 13 days for ETHGlobal Open Agents. This is the friction I hit, written down while it was fresh. Nothing here is theoretical; every item maps to a moment where I was stuck or confused.

A note up front: between my recon on **Apr 26** and my first real publish on **May 3**, KeeperHub shipped the **Listing Settings** dialog, the **List this workflow** toggle, the per-workflow USDC price field, the Input Schema builder, the Output Mapping picker, and **ERC-8004** registry publication. That's a serious amount of producer-side surface to ship in a week, and it covers most of what I would have asked for at the start of the build. Good move. The items below are what's still rough once you start using the new surface in anger.

---

## 1. The execute API contract is undocumented in two places that matter

`POST /api/workflow/{id}/execute` is the whole point of the API for paid callers, and I spent ~45 minutes guessing at it.

**Body shape.** I curled four candidates against a workflow with a defined Input Schema and watched what showed up in `Manual.data`:

| Body | `Manual.data.tokenAddress` | Workflow run |
|---|---|---|
| `{"input": {tokenAddress, chain}}` | populated | succeeded |
| `{"triggerData": {...}}` | empty | failed downstream |
| `{tokenAddress, chain}` (bare) | empty | failed downstream |
| `{"data": {...}}` | empty | failed downstream |

The wrong shapes don't 4xx — KH happily returns an `executionId` and runs the workflow with empty inputs, so the failure surfaces several seconds later as a confusing low-level error from a Read Contract node. One JSON example on the docs page would have saved everyone this.

**Output retrieval.** `GET /workflows/executions/{id}/status` returns `{ status, nodeStatuses, progress, errorContext }` — no `output` field. The actual workflow output lives at `/workflows/executions/{id}/logs` under `execution.output`. I found this by curling four candidate paths (`/`, `/result`, `/output`, `/logs`). My suggestion: rename `/logs` → `/result`, return `{ status, output, error?, durationMs }`, and let `/status` stay the lightweight "is it done?" probe.

## 2. Workflow IDs don't match the prefix convention you set with `kh_…`

API keys are `kh_…`. I assumed (and my CLI's regex enforced) that workflow IDs would be `wf_…`. They're actually 21-char bare alphanumerics like `ywgf93kk1ft8944s3ax38`, taken straight from the canvas URL. My first publish bounced on regex validation and I had to relax it to `/^(wf_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{16,64})$/`. Either adopt the `wf_` prefix for consistency, or add a one-line "Workflow IDs are 21-char base32" note to the API reference.

## 3. The agentic wallet refusing Base Sepolia is the demo-killer

The KH wallet signs on Base mainnet, Tempo mainnet, and Tempo testnet. It does **not** sign on Base Sepolia (84532). Every x402 hackathon demo defaults to Base Sepolia. The result: the "two wallets for one transaction" story (KH wallet for payouts, separate dev EOA for the caller's payment) shows up in every tutorial I write, and it's the single biggest explanation tax in my SDK README. Adding 84532 to the EIP-712 allowlist behind a `wallet.testnet_chains.base_sepolia=true` org flag would erase a real onboarding wart.

## 4. ERC-8004 listing exists but there's no way to consume it

The Listing Settings dialog says "Listed workflows are discoverable by AI agents via the ERC-8004 registry." That's it. No registry contract address, no chain, no ABI, no caller-side code sample. An agent author cannot get from "I want to find paid KH workflows" to "I am calling one" without reverse-engineering the registry. I ended up shipping my own `GET /discover` endpoint as the primary discovery surface for tollgate because I had nothing to point users at. A `/docs/listings/erc-8004` page with the contract address per chain, the read functions agents call, and a TS+Python "discover then call" sample would close this.

There's also a hidden cousin: `GET /api/workflows?listed=true` works (with the org's `kh_` bearer) and returns the org's listed workflows, but it's undocumented and returns the entire workflow graph (heavy, fine for canvas re-import, wasteful for marketplace browsing). A documented public `GET /api/marketplace` returning the slim shape (`id, slug, name, description, price, payTo, network, inputSchema`) would be the right HTTP shim over the on-chain registry.

## 5. The Earnings page misses bring-your-own-paywall revenue

I ran a controlled experiment on May 3:

1. ~12 paid calls before flipping "List this workflow" → Earnings $0.00. Fine, not listed yet.
2. Flipped listing on. Earnings $0.00. Fine, no calls since.
3. One more paid call after listing was active. Hard-refreshed 30s later → **still $0.00, Total Invocations 0**.

The post-listing payment landed on Basescan exactly like the previous twelve — USDC moved from the agent EOA to the workflow author's `payTo`. KH's tracker just doesn't see it, because the USDC never touches a KH-controlled contract. Authors who use a third-party paywall (like tollgate) see $0 forever even when their wallet is filling up — surprising and demoralising. An "Off-platform revenue" row, computed by `eth_getLogs` over the workflow's listed `payTo` on the supported chains, would respect bring-your-own-paywall flows cheaply.

---

## Smaller things, one paragraph each

**The listing validator is a catch-22 for input-less workflows.** "What's the current ETH/BTC ratio?" needs no caller input. The validator requires at least one Input Schema field AND that every declared field be referenced by some node. The only escape is to invent a fake input and wire it into a node that doesn't need it. Either let zero-input workflows list, or downgrade "must be referenced" to a warning.

**Run Code outputs are wrapped in `{ logs, result, success }` and the Output Mapping dropdown can't unwrap them.** The "Filter to specific field" dropdown lists the node's *config* schema (`timeout`, `code`), not the runtime output. So `result` isn't pickable. I added an `unwrapKhRunCodeOutput` helper in the gateway as the workaround. Letting the filter field accept free-form strings would fix it.

**The canvas Run button silently ignores Input Schema.** Define `tokenAddress` (required). Press Run. Workflow runs with empty `Manual.data`, downstream Read Contract dies with "Invalid contract address: ''". If required inputs aren't satisfied, pop a modal asking for them — same JSON shape callers POST.

**Auto-fetch ABI is silently incompatible with templated contract addresses.** Set Contract Address to `{{Manual.data.tokenAddress}}`, network to Base. The auto-fetch placeholder ("ABI will be fetched automatically when a contract address and network are set") never runs, the Function dropdown stays empty, and the validator only complains on Run. Either tell authors up front to use manual ABI when the address is templated, or defer auto-fetch to first run and cache.

**`GET /api/workflow/{id}` returns 404 for workflows the org owns.** Tested on May 3 with a real `kh_…` bearer against an ID I could open in the canvas. 404, indistinguishable from "doesn't exist". My CLI ships a `--skip-validation` flag because of this. Either ship the endpoint or document the equivalent path that takes the `kh_` bearer.

**Two syntaxes for trigger inputs in the same UI.** The Input Schema tab tells authors to "type `@` and select `Manual.data.<fieldName>`." The Read Contract node's Contract Address placeholder shows `0x... or {{NodeName.contractAddress}}`. So `@Manual.data.x` and `{{NodeName.x}}` coexist, in the same workflow editor, without a sentence anywhere saying which to use when.

**Workflow rename is hard to find.** A new workflow lands as "Untitled 1". I spent ~5 minutes hunting for the rename — checked sidebar, canvas top, Listing Settings, right-click. Eventually found it. Every pre-listing screenshot in my demo folder is "Untitled 1". A pencil icon on hover in the sidebar would do it.

**No public API CHANGELOG.** I pinned tollgate's behavior to "RECON.md as of May 2". If the API changes, I won't know until something 4xx's. A `/docs/changelog` page (even sparse) would let third-party tooling stay honest.

---

## On the x402 side (Coinbase)

Two things, briefly.

**`useFacilitator({ url })` rejects plain strings.** The TS type wants a branded `Resource` URL (`${string}://${string}`), so `useFacilitator({ url: process.env.X402_FACILITATOR_URL })` fails the type check. Every integrator does the same `as unknown as FacilitatorConfig` cast, which is exactly what brands are meant to prevent. Export a `toResource(url: string): Resource` helper from `x402/types`.

**Python has no `wrapFetchWithPayment` equivalent.** TS ships `x402-fetch.wrapFetchWithPayment(fetch, wallet, maxValue)` — one line, you're done. Python ships only the lower primitives (`x402Client.create_payment_payload` + `encode_payment_signature_header`), so every Python integrator re-implements the 402 dance. I wrote ~70 lines of glue in `packages/sdk-py/src/keepertoll/client.py` that should have been one. Shipping `x402-httpx` as the Python parallel would unlock LangChain / CrewAI / Inspect / Autogen integrations without each consumer writing the same glue.

---

## tl;dr — if I were on the KeeperHub team, my first two PRs would be

1. **Document the execute API contract.** One JSON example for `POST /workflow/{id}/execute`, plus a sentence explaining that `output` lives at `/logs` under `execution.output`. Twenty minutes of doc work, kills the single biggest "wait, does it work?" footgun in the API.

2. **A `/docs/listings/erc-8004` page** with the registry contract per chain, the agent-side read functions, and a 30-line TS+Python "discover then call a listed workflow" sample. The listing toggle is great; right now it ships into a vacuum because the read side has no on-ramp.

I'm at sachinhlo232@gmail.com if any of this is worth chatting about after the hackathon. Happy to file these as individual issues against your repos if that's more useful than one Markdown file.
