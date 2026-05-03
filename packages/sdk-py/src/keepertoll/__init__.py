"""keepertoll — Python SDK for calling x402-paid KeeperHub workflows.

Mirrors the surface of `@keepertoll/client` (TypeScript). Async-first.
"""

from keepertoll.client import KeeperHubClient
from keepertoll.errors import (
    DiscoverFailedError,
    GatewayUnreachableError,
    KeepertollSdkError,
    NoWalletConfiguredError,
    PaymentExceedsBudgetError,
    UnexpectedStatusError,
    WorkflowExecutionError,
)
from keepertoll.types import (
    DiscoveredWorkflow,
    RunFailure,
    RunPayment,
    RunPending,
    RunResult,
    RunSuccess,
    SupportedChain,
)

__all__ = [
    "DiscoverFailedError",
    "DiscoveredWorkflow",
    "GatewayUnreachableError",
    "KeeperHubClient",
    "KeepertollSdkError",
    "NoWalletConfiguredError",
    "PaymentExceedsBudgetError",
    "RunFailure",
    "RunPayment",
    "RunPending",
    "RunResult",
    "RunSuccess",
    "SupportedChain",
    "UnexpectedStatusError",
    "WorkflowExecutionError",
]
__version__ = "0.1.0"
