"""KeeperHubClient — async Python client for the keepertoll x402 gateway.

Mirrors the surface of `packages/sdk-ts/src/index.ts`:

    client = KeeperHubClient(
        gateway_url="http://localhost:3030",
        private_key="0x...",            # omit for discover-only mode
        chain="base-sepolia",
        max_payment_atomic=100_000,     # 0.10 USDC ceiling per call
    )

    workflows = await client.discover()
    result = await client.run(workflow_id="wf_demo", input={"foo": "bar"}, wait=True)
    print(client.total_spent_usdc, "USDC across", client.calls_paid, "call(s)")

The 402 dance:
    POST /run/:id  →  402 + PaymentRequiredV1
    create_payment_payload via x402Client + EthAccountSigner
    encode as base64 → X-PAYMENT header
    POST /run/:id with header  →  200 + run result
"""

from __future__ import annotations

import json
from typing import Any, cast

import httpx
from eth_account import Account
from eth_account.signers.local import LocalAccount
from x402 import x402Client
from x402.http.utils import encode_payment_signature_header
from x402.mechanisms.evm.exact import register_exact_evm_client
from x402.mechanisms.evm.signers import EthAccountSigner
from x402.schemas.v1 import PaymentRequiredV1

from .errors import (
    DiscoverFailedError,
    GatewayUnreachableError,
    NoWalletConfiguredError,
    PaymentExceedsBudgetError,
    UnexpectedStatusError,
    WorkflowExecutionError,
)
from .types import DiscoveredWorkflow, RunResult, SupportedChain

PRICE_DECIMALS = 6  # USDC


class KeeperHubClient:
    """Async client for discovering and calling x402-paid KeeperHub workflows.

    Mirrors `KeeperHubClient` in `@keepertoll/client` (TypeScript).
    """

    gateway_url: str
    has_wallet: bool
    chain: SupportedChain
    total_spent_atomic: int
    calls_paid: int

    def __init__(
        self,
        *,
        gateway_url: str,
        private_key: str | None = None,
        account: LocalAccount | None = None,
        chain: SupportedChain = "base-sepolia",
        max_payment_atomic: int = 100_000,
        timeout: float = 30.0,
    ) -> None:
        """Construct a client.

        Args:
            gateway_url: Base URL of a keepertoll gateway, e.g. ``http://localhost:3030``.
            private_key: 0x-prefixed EOA private key for signing x402 payments.
                Omit (with ``account``) for discover-only mode.
            account: Pre-built ``eth_account.LocalAccount`` (alternative to ``private_key``).
            chain: x402 network for the wallet client. Default ``"base-sepolia"``.
            max_payment_atomic: Per-call ceiling in atomic USDC (6 decimals).
                Default 100_000 = 0.10 USDC.
            timeout: HTTP timeout per request.

        Raises:
            ValueError: If both ``private_key`` and ``account`` are given.
        """
        self.gateway_url = gateway_url.rstrip("/")
        self.chain = chain
        self.total_spent_atomic = 0
        self.calls_paid = 0
        self._max_payment_atomic = max_payment_atomic
        self._timeout = timeout
        self._discover_cache: dict[str, DiscoveredWorkflow] | None = None

        if private_key is not None and account is not None:
            raise ValueError("pass either private_key or account, not both")

        resolved_account: LocalAccount | None = account
        if resolved_account is None and private_key is not None:
            resolved_account = cast(LocalAccount, Account.from_key(private_key))

        self._account: LocalAccount | None = resolved_account
        self.has_wallet = resolved_account is not None

        if resolved_account is not None:
            x_client = x402Client()
            signer = EthAccountSigner(resolved_account)
            register_exact_evm_client(x_client, signer)
            self._x402_client: x402Client | None = x_client
        else:
            self._x402_client = None

        self._http = httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._http.aclose()

    async def __aenter__(self) -> KeeperHubClient:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    @property
    def total_spent_usdc(self) -> str:
        """Human-readable total spend, e.g. ``"0.040000"``. Mirrors TS."""
        return _format_atomic(self.total_spent_atomic, PRICE_DECIMALS)

    async def discover(self) -> list[DiscoveredWorkflow]:
        """Fetch all workflows registered on the gateway (no payment required)."""
        try:
            res = await self._http.get(f"{self.gateway_url}/discover")
        except httpx.RequestError as err:
            raise GatewayUnreachableError(self.gateway_url, str(err)) from err
        if not res.is_success:
            raise DiscoverFailedError(res.status_code, res.text)
        body: dict[str, Any] = res.json()
        workflows_raw = body.get("workflows", [])
        if not isinstance(workflows_raw, list):
            raise UnexpectedStatusError(f"discover response missing 'workflows' list: {body!r}")
        workflows: list[DiscoveredWorkflow] = [cast(DiscoveredWorkflow, w) for w in workflows_raw]
        self._discover_cache = {w["workflowId"]: w for w in workflows}
        return workflows

    async def get_workflow(self, workflow_id: str) -> DiscoveredWorkflow | None:
        """Lookup a single workflow. Cached after the first ``discover()`` call."""
        if self._discover_cache is None:
            await self.discover()
        if self._discover_cache is None:  # pragma: no cover
            return None
        return self._discover_cache.get(workflow_id)

    async def run(
        self,
        *,
        workflow_id: str,
        input: object | None = None,
        wait: bool = False,
        max_wait_ms: int | None = None,
    ) -> RunResult:
        """Pay the gateway and call a workflow.

        Raises:
            NoWalletConfiguredError: The client was constructed without a wallet.
            PaymentExceedsBudgetError: The workflow's price exceeds ``max_payment_atomic``.
            WorkflowExecutionError: The gateway returned non-2xx after payment.
            GatewayUnreachableError: Network failure contacting the gateway.
        """
        if self._x402_client is None:
            raise NoWalletConfiguredError(
                "no wallet configured; pass private_key or account to run()"
            )

        url = f"{self.gateway_url}/run/{workflow_id}"
        params: dict[str, str] = {}
        if wait:
            params["wait"] = "true"
            if max_wait_ms is not None:
                params["maxWaitMs"] = str(max_wait_ms)

        body_json: str | None = None if input is None else json.dumps(input)
        request_kwargs: dict[str, Any] = {
            "url": url,
            "params": params,
            "headers": {"content-type": "application/json", "accept": "application/json"},
        }
        if body_json is not None:
            request_kwargs["content"] = body_json

        try:
            first = await self._http.post(**request_kwargs)
        except httpx.RequestError as err:
            raise GatewayUnreachableError(self.gateway_url, str(err)) from err

        if first.status_code == 402:
            payment_header = await self._build_payment_header(workflow_id, first)
            request_kwargs["headers"] = {
                **request_kwargs["headers"],
                "x-payment": payment_header,
            }
            try:
                paid = await self._http.post(**request_kwargs)
            except httpx.RequestError as err:
                raise GatewayUnreachableError(self.gateway_url, str(err)) from err
            return await self._parse_run_response(workflow_id, paid)

        if first.is_success:
            return await self._parse_run_response(workflow_id, first)

        raise WorkflowExecutionError(first.status_code, first.text)

    async def _build_payment_header(self, workflow_id: str, response: httpx.Response) -> str:
        body: dict[str, Any] = response.json()
        accepts = body.get("accepts")
        if not isinstance(accepts, list) or len(accepts) == 0:
            raise UnexpectedStatusError(f"402 body missing accepts[]: {body!r}")

        try:
            requirements = PaymentRequiredV1.model_validate(body)
        except Exception as err:
            raise UnexpectedStatusError(f"could not parse 402 body as V1: {body!r}") from err

        # Budget check — refuse to sign if any acceptable price exceeds the cap.
        # Mirrors x402-fetch's `maxValue` behavior used in the TS SDK.
        for req in requirements.accepts:
            requested = int(req.max_amount_required)
            if requested > self._max_payment_atomic:
                raise PaymentExceedsBudgetError(workflow_id, requested, self._max_payment_atomic)

        if self._x402_client is None:  # pragma: no cover — guarded above
            raise NoWalletConfiguredError("no wallet configured")
        payload = await self._x402_client.create_payment_payload(requirements)
        return encode_payment_signature_header(payload)

    async def _parse_run_response(self, workflow_id: str, response: httpx.Response) -> RunResult:
        if not response.is_success:
            raise WorkflowExecutionError(response.status_code, response.text)
        body: dict[str, Any] = response.json()

        # Track spend on the price of the called workflow.
        wf = await self.get_workflow(workflow_id)
        if wf is not None:
            self.total_spent_atomic += _parse_usdc_atomic(wf["price"])
            self.calls_paid += 1

        return cast(RunResult, body)


def _parse_usdc_atomic(human: str) -> int:
    """Convert ``"0.02"`` (USDC, 6 decimals) → ``20000``."""
    parts = human.split(".")
    whole = parts[0] or "0"
    fraction = parts[1] if len(parts) > 1 else ""
    padded = (fraction + "0" * PRICE_DECIMALS)[:PRICE_DECIMALS]
    return int(f"{whole}{padded}")


def _format_atomic(value: int, decimals: int) -> str:
    """Convert ``20000`` (decimals=6) → ``"0.020000"``."""
    divisor = 10**decimals
    whole, frac = divmod(value, divisor)
    return f"{whole}.{str(frac).zfill(decimals)}"
