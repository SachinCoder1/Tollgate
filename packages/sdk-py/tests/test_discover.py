"""Discovery + workflow lookup."""

from __future__ import annotations

import httpx
import pytest
import respx

from keepertoll import (
    DiscoverFailedError,
    GatewayUnreachableError,
    KeeperHubClient,
)

GATEWAY_URL = "http://test-gateway"

SAMPLE_DISCOVER = {
    "gatewayVersion": "0.1.0",
    "workflows": [
        {
            "workflowId": "wf_safety",
            "price": "0.02",
            "currency": "USDC",
            "network": "base-sepolia",
            "payTo": "0x1111111111111111111111111111111111111111",
            "description": "ERC-20 safety report",
            "endpointUrl": f"{GATEWAY_URL}/run/wf_safety",
            "registeredAt": "2026-05-02T00:00:00Z",
        },
        {
            "workflowId": "wf_price",
            "price": "0.03",
            "currency": "USDC",
            "network": "base-sepolia",
            "payTo": "0x2222222222222222222222222222222222222222",
            "description": "Stablecoin price",
            "endpointUrl": f"{GATEWAY_URL}/run/wf_price",
            "registeredAt": "2026-05-02T00:01:00Z",
        },
    ],
}


async def test_discover_returns_two(
    discover_only_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    respx_mock.get("/discover").mock(return_value=httpx.Response(200, json=SAMPLE_DISCOVER))
    workflows = await discover_only_client.discover()
    assert len(workflows) == 2
    assert workflows[0]["workflowId"] == "wf_safety"
    assert workflows[1]["price"] == "0.03"


async def test_get_workflow_uses_cache(
    discover_only_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    route = respx_mock.get("/discover").mock(return_value=httpx.Response(200, json=SAMPLE_DISCOVER))
    found = await discover_only_client.get_workflow("wf_safety")
    assert found is not None
    assert found["workflowId"] == "wf_safety"
    # Second lookup hits cache, no extra HTTP call.
    again = await discover_only_client.get_workflow("wf_price")
    assert again is not None
    assert again["workflowId"] == "wf_price"
    assert route.call_count == 1


async def test_get_workflow_missing_returns_none(
    discover_only_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    respx_mock.get("/discover").mock(return_value=httpx.Response(200, json=SAMPLE_DISCOVER))
    assert await discover_only_client.get_workflow("wf_nope") is None


async def test_discover_non_2xx_raises_typed(
    discover_only_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    respx_mock.get("/discover").mock(return_value=httpx.Response(500, text="boom"))
    with pytest.raises(DiscoverFailedError) as exc:
        await discover_only_client.discover()
    assert exc.value.status_code == 500


async def test_discover_network_failure_raises_typed(
    discover_only_client: KeeperHubClient, respx_mock: respx.MockRouter
):
    respx_mock.get("/discover").mock(side_effect=httpx.ConnectError("connection refused"))
    with pytest.raises(GatewayUnreachableError) as exc:
        await discover_only_client.discover()
    assert exc.value.url == GATEWAY_URL
