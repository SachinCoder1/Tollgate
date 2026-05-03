"""Python reference agent — mirrors `packages/examples/reference-agent/src/index.ts`.

Narrative: "Should I swap N USDC for token Y on Base?"
  1. DISCOVER  — list paid workflows on the gateway
  2. PAY+CALL  — StablecoinPriceCheck   "is USDC at peg?"
  3. PAY+CALL  — TokenSafetyCheck       "is token Y safe?"
  4. COMPOSE   — yes / wait / no
  5. TOTAL     — running spend

Modes:
  - real     — needs AGENT_PRIVATE_KEY (Base Sepolia EOA with USDC + ETH)
  - simulate — no key needed; prints same markers without paying

Run:
    GATEWAY_PUBLIC_URL=http://localhost:3030 \\
    SIMULATE=1 \\
    .venv/bin/python -m examples.agent
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any, cast

from keepertoll import DiscoveredWorkflow, KeeperHubClient

GATEWAY_URL = os.environ.get("GATEWAY_PUBLIC_URL", "http://localhost:3030")
PRIVATE_KEY = os.environ.get("AGENT_PRIVATE_KEY")
SIMULATE = os.environ.get("SIMULATE") in {"1", "true"}
TOKEN_SAFETY_ID = os.environ.get("WORKFLOW_TOKEN_SAFETY_ID")
PRICE_CHECK_ID = os.environ.get("WORKFLOW_STABLECOIN_PRICE_ID")

SCENARIO = {
    "amount_usdc": os.environ.get("SCENARIO_AMOUNT_USDC", "100"),
    "stablecoin": os.environ.get("SCENARIO_STABLECOIN", "USDC"),
    "token_address": os.environ.get(
        "SCENARIO_TOKEN_ADDRESS", "0x4200000000000000000000000000000000000006"
    ),
    "chain": os.environ.get("SCENARIO_CHAIN", "base"),
}


def _color(code: str, s: str) -> str:
    if not sys.stdout.isatty() or "NO_COLOR" in os.environ:
        return s
    return f"\x1b[{code}m{s}\x1b[0m"


def _bold_cyan(s: str) -> str:
    return _color("1;36", s)


def _bold_yellow(s: str) -> str:
    return _color("1;33", s)


def _bold_blue(s: str) -> str:
    return _color("1;34", s)


def _bold_green(s: str) -> str:
    return _color("1;32", s)


def _bold_magenta(s: str) -> str:
    return _color("1;35", s)


def _dim(s: str) -> str:
    return _color("2", s)


def _ok() -> str:
    return _color("32", "✓")


def _warn() -> str:
    return _color("33", "•")


def _bad() -> str:
    return _color("31", "✗")


def _pick(
    workflows: list[DiscoveredWorkflow], explicit_id: str | None, hints: list[str]
) -> DiscoveredWorkflow | None:
    if explicit_id:
        for w in workflows:
            if w["workflowId"] == explicit_id:
                return w
        return None
    for w in workflows:
        desc = (w.get("description") or "").lower()
        if any(h in desc for h in hints):
            return w
    return None


def _fake_price() -> dict[str, Any]:
    return {"median": 1.0001, "maxDeviationPct": 0.07, "confidence": "high", "anomaly": False}


def _fake_safety() -> dict[str, Any]:
    return {
        "risk": "low",
        "recommendation": "Safe to interact based on the signals checked.",
        "symbol": "WETH",
        "signals": {
            "in_uniswap_default_list": True,
            "has_metadata": True,
            "is_proxy": False,
            "owner_renounced": True,
        },
    }


def _compose(price: dict[str, Any], safety: dict[str, Any]) -> tuple[str, str]:
    swap = (
        f"swap {SCENARIO['amount_usdc']} {SCENARIO['stablecoin']} for "
        f"{safety.get('symbol', 'token')} ({SCENARIO['token_address'][:10]}…) on {SCENARIO['chain']}"
    )
    if price.get("anomaly"):
        return _bad(), (
            f"Wait — {SCENARIO['stablecoin']} is off-peg "
            f"(median={price['median']}, deviation={price['maxDeviationPct']}%). Don't {swap}."
        )
    risk = safety.get("risk")
    if risk == "high":
        return _bad(), f"Do not {swap}. {safety.get('recommendation')}"
    if risk == "medium":
        return _warn(), (
            f"Caution — {safety.get('recommendation')} {SCENARIO['stablecoin']} at peg "
            f"(deviation {price['maxDeviationPct']}%); proceed with smaller test amount first."
        )
    return _ok(), (
        f"Yes, {swap}. {SCENARIO['stablecoin']} at peg "
        f"(deviation {price['maxDeviationPct']}%, confidence {price['confidence']}); "
        f"{safety.get('recommendation')}"
    )


async def _run_or_simulate(
    client: KeeperHubClient,
    wf: DiscoveredWorkflow,
    input_data: dict[str, Any],
    simulate: bool,
    fake_output: dict[str, Any],
) -> dict[str, Any]:
    if simulate:
        return {
            "output": fake_output,
            "payment": {"network": wf["network"], "txHash": "0xsimulated", "payer": "0xsimulated"},
        }
    result = await client.run(
        workflow_id=wf["workflowId"], input=input_data, wait=True, max_wait_ms=25_000
    )
    if result["status"] == "success":
        success = cast(dict[str, Any], result)
        return {"output": success["output"], "payment": success["payment"]}
    if result["status"] == "pending":
        pending = cast(dict[str, Any], result)
        raise RuntimeError(
            f"workflow {wf['workflowId']} returned pending; demo expects ?wait=true. "
            f"statusUrl={pending.get('statusUrl')}"
        )
    failed = cast(dict[str, Any], result)
    raise RuntimeError(f"workflow {wf['workflowId']} {result['status']}: {failed.get('error')}")


async def main() -> int:
    use_simulate = SIMULATE or PRIVATE_KEY is None
    sys.stdout.write("keepertoll reference agent (python)\n")
    sys.stdout.write(
        _dim(
            f"scenario: should I {SCENARIO['amount_usdc']} {SCENARIO['stablecoin']} → "
            f"{SCENARIO['token_address'][:10]}… on {SCENARIO['chain']}?\n"
        )
    )
    sys.stdout.write(_dim(f"gateway:  {GATEWAY_URL}\n\n"))

    if use_simulate and not SIMULATE:
        sys.stdout.write(
            _color("33", "note")
            + ": AGENT_PRIVATE_KEY not set — falling back to simulate mode.\n\n"
        )

    pk_for_client = PRIVATE_KEY if PRIVATE_KEY and not use_simulate else None
    client = KeeperHubClient(
        gateway_url=GATEWAY_URL,
        private_key=pk_for_client,
        chain="base-sepolia",
        max_payment_atomic=50_000,
    )

    try:
        sys.stdout.write(f"{_bold_cyan('[DISCOVER]')} GET {GATEWAY_URL}/discover\n")
        try:
            workflows = await client.discover()
        except Exception as err:
            sys.stderr.write(f"{_bad()} discover failed: {err}\n")
            return 1
        if not workflows:
            sys.stderr.write(f"{_bad()} no workflows registered.\n")
            return 1
        sys.stdout.write(f"{_ok()} {len(workflows)} workflow(s) discovered:\n")
        for w in workflows:
            sys.stdout.write(
                f"   {_bold_cyan(w['workflowId'])}  {w['price']} {w['currency']} on {w['network']}  "
                f"— {w.get('description', '(no description)')}\n"
            )
        sys.stdout.write("\n")

        price_wf = _pick(workflows, PRICE_CHECK_ID, ["price", "stablecoin", "depeg"])
        safety_wf = _pick(workflows, TOKEN_SAFETY_ID, ["safety", "token", "allowlist"])
        if price_wf is None or safety_wf is None:
            sys.stderr.write(f"{_bad()} could not pick both workflows; set explicit IDs.\n")
            return 1

        sim_tag = _dim("(simulated — no AGENT_PRIVATE_KEY)") if use_simulate else ""
        sys.stdout.write(
            f"{_bold_yellow('[PAY $' + price_wf['price'] + ']')} "
            f"{_bold_blue('[CALL ' + price_wf['workflowId'] + ']')} "
            f"input={json.dumps({'stablecoin': SCENARIO['stablecoin'], 'chain': SCENARIO['chain']})} {sim_tag}\n"
        )
        price_result = await _run_or_simulate(
            client,
            price_wf,
            {"stablecoin": SCENARIO["stablecoin"], "chain": SCENARIO["chain"]},
            use_simulate,
            _fake_price(),
        )
        sys.stdout.write(f"{_bold_green('[RESULT]')} {json.dumps(price_result['output'])}\n\n")

        sys.stdout.write(
            f"{_bold_yellow('[PAY $' + safety_wf['price'] + ']')} "
            f"{_bold_blue('[CALL ' + safety_wf['workflowId'] + ']')} "
            f"input={json.dumps({'tokenAddress': SCENARIO['token_address'], 'chain': SCENARIO['chain']})} {sim_tag}\n"
        )
        safety_result = await _run_or_simulate(
            client,
            safety_wf,
            {"tokenAddress": SCENARIO["token_address"], "chain": SCENARIO["chain"]},
            use_simulate,
            _fake_safety(),
        )
        sys.stdout.write(f"{_bold_green('[RESULT]')} {json.dumps(safety_result['output'])}\n")

        icon, text = _compose(price_result["output"], safety_result["output"])
        sys.stdout.write(f"\n{_bold_magenta('[COMPOSED ANSWER]')} {icon} {text}\n\n")

        if use_simulate:
            total = f"{float(price_wf['price']) + float(safety_wf['price']):.2f}"
            calls = 2
        else:
            total = client.total_spent_usdc
            calls = client.calls_paid
        sys.stdout.write(f"[TOTAL SPEND ${total}] {calls} paid call(s) {sim_tag}\n")
        return 0
    finally:
        await client.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
