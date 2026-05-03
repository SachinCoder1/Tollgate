"""Shared pytest fixtures."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest_asyncio
import respx

from keepertoll import KeeperHubClient

# A throwaway test private key. Address: 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf.
TEST_PRIVATE_KEY = "0x" + "1" * 64

GATEWAY_URL = "http://test-gateway"


@pytest_asyncio.fixture
async def discover_only_client() -> AsyncIterator[KeeperHubClient]:
    """Client with no wallet — only discover() is callable."""
    c = KeeperHubClient(gateway_url=GATEWAY_URL)
    try:
        yield c
    finally:
        await c.aclose()


@pytest_asyncio.fixture
async def signing_client() -> AsyncIterator[KeeperHubClient]:
    """Client with the throwaway test wallet wired."""
    c = KeeperHubClient(gateway_url=GATEWAY_URL, private_key=TEST_PRIVATE_KEY)
    try:
        yield c
    finally:
        await c.aclose()


def integration_enabled() -> bool:
    """Allow opt-in integration runs against a real gateway."""
    return os.environ.get("KEEPERTOLL_INTEGRATION") == "1"


@pytest_asyncio.fixture
async def respx_mock() -> AsyncIterator[respx.MockRouter]:
    """respx router for stubbing HTTP responses."""
    with respx.mock(base_url=GATEWAY_URL, assert_all_called=False) as router:
        yield router
