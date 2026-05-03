"""Typed exceptions raised by the keepertoll SDK.

Mirrors `KeepertollSdkError` (TypeScript SDK doesn't define typed errors —
this side adds them so callers can `except` on a specific failure mode
instead of pattern-matching strings).
"""

from __future__ import annotations


class KeepertollSdkError(Exception):
    """Base class for everything raised by keepertoll."""


class NoWalletConfiguredError(KeepertollSdkError):
    """Raised when ``run()`` is called on a discover-only client.

    Pass ``private_key`` (or ``account``) at construction to enable paying.
    """


class GatewayUnreachableError(KeepertollSdkError):
    """Raised when the keepertoll gateway can't be reached over the network."""

    def __init__(self, url: str, cause: str) -> None:
        super().__init__(f"could not reach gateway at {url}: {cause}")
        self.url = url
        self.cause = cause


class DiscoverFailedError(KeepertollSdkError):
    """Raised when ``GET /discover`` returned a non-2xx response."""

    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"discover failed: HTTP {status_code} — {body[:300]}")
        self.status_code = status_code
        self.body = body


class PaymentExceedsBudgetError(KeepertollSdkError):
    """Raised when the workflow's price exceeds the client's per-call ceiling."""

    def __init__(self, workflow_id: str, requested: int, ceiling: int) -> None:
        super().__init__(
            f"workflow {workflow_id} requires {requested} atomic USDC; "
            f"client ceiling is {ceiling}. Raise max_payment_atomic to allow."
        )
        self.workflow_id = workflow_id
        self.requested = requested
        self.ceiling = ceiling


class WorkflowExecutionError(KeepertollSdkError):
    """Raised when the gateway returns non-2xx after the payment was attempted."""

    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"workflow run failed: HTTP {status_code} — {body[:300]}")
        self.status_code = status_code
        self.body = body


class UnexpectedStatusError(KeepertollSdkError):
    """Raised when the response shape doesn't match what the SDK expected."""
