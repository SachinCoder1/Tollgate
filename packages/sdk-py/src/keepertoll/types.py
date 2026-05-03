"""Public type aliases mirrored from `packages/sdk-ts/src/index.ts`.

Use ``TypedDict`` so dict-shaped responses from the gateway map cleanly
without forcing callers to construct dataclasses.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

SupportedChain = Literal["base-sepolia", "base"]
"""Same set the TypeScript SDK supports."""


class DiscoveredWorkflow(TypedDict):
    """One workflow returned by ``GET /discover``. Mirrors `DiscoveredWorkflow` in TS."""

    workflowId: str
    price: str
    currency: str
    network: str
    payTo: str
    description: NotRequired[str]
    endpointUrl: str
    registeredAt: str


class RunPayment(TypedDict):
    """Settlement metadata attached to every successful run."""

    network: str
    txHash: NotRequired[str]
    payer: NotRequired[str]


class _RunBase(TypedDict):
    executionId: str
    runId: NotRequired[str]
    payment: RunPayment


class RunPending(_RunBase):
    status: Literal["pending"]
    statusUrl: str


class RunSuccess(_RunBase):
    status: Literal["success"]
    output: object
    durationMs: int


class RunFailure(_RunBase):
    status: Literal["error", "cancelled"]
    error: str


RunResult = RunPending | RunSuccess | RunFailure
"""Discriminated union mirroring ``RunResult`` in TS."""
