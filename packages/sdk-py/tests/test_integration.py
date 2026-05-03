"""Integration test: spin up the local node gateway and exercise discover.

Skipped unless ``KEEPERTOLL_INTEGRATION=1`` is set, since spawning node from
pytest is heavy and depends on the workspace being built.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest
from tests.conftest import integration_enabled

from keepertoll import KeeperHubClient

REPO_ROOT = Path(__file__).resolve().parents[3]
GATEWAY_ENTRY = REPO_ROOT / "packages" / "gateway" / "dist" / "server.js"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = int(s.getsockname()[1])
    return port


async def _wait_healthy(url: str, timeout_s: float = 10.0) -> None:
    deadline = asyncio.get_event_loop().time() + timeout_s
    async with httpx.AsyncClient() as h:
        while asyncio.get_event_loop().time() < deadline:
            try:
                r = await h.get(f"{url}/healthz")
                if r.is_success:
                    return
            except httpx.RequestError:
                pass
            await asyncio.sleep(0.1)
    raise TimeoutError(f"gateway did not become healthy at {url} within {timeout_s}s")


@pytest.mark.integration
@pytest.mark.skipif(not integration_enabled(), reason="set KEEPERTOLL_INTEGRATION=1 to run")
async def test_integration_discover_against_local_gateway() -> None:
    if not GATEWAY_ENTRY.exists():
        pytest.skip(f"gateway not built; run `pnpm run build` first ({GATEWAY_ENTRY})")
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH")

    port = _free_port()
    public_url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory() as tmpdir:
        env = {
            **os.environ,
            "GATEWAY_PORT": str(port),
            "GATEWAY_PUBLIC_URL": public_url,
            "GATEWAY_REGISTRY_PATH": f"{tmpdir}/registry.json",
            "GATEWAY_AUDIT_LOG_PATH": f"{tmpdir}/audit.log",
            "GATEWAY_ADMIN_TOKEN": secrets.token_hex(16),
            "PATH": os.environ.get("PATH", ""),
        }
        proc = subprocess.Popen(
            [node, str(GATEWAY_ENTRY)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            await _wait_healthy(public_url)
            client = KeeperHubClient(gateway_url=public_url)
            try:
                workflows = await client.discover()
                assert isinstance(workflows, list)
            finally:
                await client.aclose()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
