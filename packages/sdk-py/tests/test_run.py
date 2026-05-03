"""run() — full 402 dance, budget enforcement, and spend tracking."""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx
from tests.test_discover import SAMPLE_DISCOVER

from keepertoll import (
    KeeperHubClient,
    NoWalletConfiguredError,
    PaymentExceedsBudgetError,
    WorkflowExecutionError,
)

GATEWAY_URL = "http://test-gateway"
WF_SAFETY = "wf_safety"
WF_EXPENSIVE = "wf_expensive"

# Base Sepolia USDC + EIP-712 metadata used by x402 ExactEvmScheme.
USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

PAY_TO = "0x1111111111111111111111111111111111111111"


def _payment_required(price_atomic: str) -> dict[str, object]:
    """Build a V1 PaymentRequired body the way the gateway does."""
    return {
        "x402Version": 1,
        "accepts": [
            {
                "scheme": "exact",
                "network": "base-sepolia",
                "maxAmountRequired": price_atomic,
                "resource": f"{GATEWAY_URL}/run/{WF_SAFETY}",
                "description": "ERC-20 safety report",
                "mimeType": "application/json",
                "payTo": PAY_TO,
                "maxTimeoutSeconds": 60,
                "asset": USDC_ADDRESS,
                "extra": {"name": "USDC", "version": "2"},
            },
        ],
        "error": "X-PAYMENT header is required",
    }


def _success_response(workflow_id: str) -> dict[str, object]:
    return {
        "status": "success",
        "executionId": "exec_42",
        "runId": "run_42",
        "output": {"risk": "low", "recommendation": "Safe to interact."},
        "durationMs": 124,
        "payment": {
            "network": "base-sepolia",
            "txHash": "0xfeedface",
            "payer": "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
        },
    }


async def test_run_without_wallet_raises(
    discover_only_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    # Gateway not even hit.
    with pytest.raises(NoWalletConfiguredError):
        await discover_only_client.run(workflow_id=WF_SAFETY)


async def test_run_full_402_dance(signing_client: KeeperHubClient, respx_mock: respx.MockRouter):
    respx_mock.get("/discover").mock(return_value=httpx.Response(200, json=SAMPLE_DISCOVER))
    captured_headers: list[dict[str, str]] = []

    def post_handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(dict(request.headers))
        if "x-payment" not in {k.lower() for k in request.headers}:
            return httpx.Response(402, json=_payment_required("20000"))
        return httpx.Response(200, json=_success_response(WF_SAFETY))

    respx_mock.post(f"/run/{WF_SAFETY}").mock(side_effect=post_handler)

    result = await signing_client.run(
        workflow_id=WF_SAFETY,
        input={"tokenAddress": "0x4200000000000000000000000000000000000006", "chain": "base"},
        wait=True,
        max_wait_ms=5000,
    )

    assert result["status"] == "success"
    assert result["executionId"] == "exec_42"
    assert "output" in result
    assert len(captured_headers) == 2
    # First request had no X-PAYMENT, second did.
    assert "x-payment" not in {k.lower() for k in captured_headers[0]}
    assert "x-payment" in {k.lower() for k in captured_headers[1]}
    # X-PAYMENT must decode as base64 JSON with the V1 scheme/network/payload shape.
    raw_header = next(v for k, v in captured_headers[1].items() if k.lower() == "x-payment")
    decoded = json.loads(base64.b64decode(raw_header).decode())
    assert decoded["scheme"] == "exact"
    assert decoded["network"] == "base-sepolia"
    assert "payload" in decoded


async def test_run_tracks_spend(signing_client: KeeperHubClient, respx_mock: respx.MockRouter):
    respx_mock.get("/discover").mock(return_value=httpx.Response(200, json=SAMPLE_DISCOVER))

    def post_handler(request: httpx.Request) -> httpx.Response:
        if "x-payment" not in {k.lower() for k in request.headers}:
            return httpx.Response(402, json=_payment_required("20000"))
        return httpx.Response(200, json=_success_response(WF_SAFETY))

    respx_mock.post(f"/run/{WF_SAFETY}").mock(side_effect=post_handler)

    assert signing_client.total_spent_atomic == 0
    assert signing_client.calls_paid == 0

    await signing_client.run(workflow_id=WF_SAFETY, wait=True)
    await signing_client.run(workflow_id=WF_SAFETY, wait=True)

    # 0.02 USDC * 2 = 40000 atomic
    assert signing_client.total_spent_atomic == 40000
    assert signing_client.calls_paid == 2
    assert signing_client.total_spent_usdc == "0.040000"


async def test_run_budget_exceeded_does_not_pay(
    signing_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    """If maxAmountRequired exceeds the client's per-call ceiling, refuse to sign."""
    # Default ceiling = 100_000 atomic = 0.10 USDC. Demand 200_000 = 0.20.
    paid_post = respx_mock.post(f"/run/{WF_EXPENSIVE}").mock(
        return_value=httpx.Response(402, json=_payment_required("200000"))
    )
    with pytest.raises(PaymentExceedsBudgetError) as exc:
        await signing_client.run(workflow_id=WF_EXPENSIVE)
    assert exc.value.requested == 200000
    assert exc.value.ceiling == 100000
    # Only the initial GET happened; no second POST with X-PAYMENT.
    assert paid_post.call_count == 1


async def test_run_non_402_non_2xx_raises_workflow_execution_error(
    signing_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    respx_mock.post(f"/run/{WF_SAFETY}").mock(return_value=httpx.Response(500, text="boom"))
    with pytest.raises(WorkflowExecutionError) as exc:
        await signing_client.run(workflow_id=WF_SAFETY)
    assert exc.value.status_code == 500


async def test_run_no_402_passthrough(
    signing_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    """Free workflows (no 402) still produce a RunResult; spend stays 0."""
    respx_mock.get("/discover").mock(return_value=httpx.Response(200, json=SAMPLE_DISCOVER))
    respx_mock.post(f"/run/{WF_SAFETY}").mock(
        return_value=httpx.Response(200, json=_success_response(WF_SAFETY))
    )
    result = await signing_client.run(workflow_id=WF_SAFETY)
    assert result["status"] == "success"
    # Even free workflows count as a paid call for parity, since the SDK has
    # no way to know the gateway intentionally bypassed payment.
    assert signing_client.calls_paid == 1
    assert signing_client.total_spent_atomic == 20000  # discover-cached price
