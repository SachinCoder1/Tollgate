"""Phase 1 stub of the Python KeeperHubClient.

The real client (wallet signing, x402 payment retry, budget tracking,
execution polling) lands in Phase 5. The shape here mirrors
`packages/sdk-ts/src/index.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KeeperHubClientOptions:
    """Construction options for :class:`KeeperHubClient`.

    Attributes:
        gateway_url: Base URL of a keepertoll gateway, e.g. ``http://localhost:3030``.
    """

    gateway_url: str


class KeeperHubClient:
    """Client for calling x402-paid KeeperHub workflows through a keepertoll gateway.

    Phase 1: methods are not yet implemented.

    Example:
        >>> client = KeeperHubClient(KeeperHubClientOptions(gateway_url="http://localhost:3030"))
        >>> client.gateway_url
        'http://localhost:3030'
    """

    def __init__(self, options: KeeperHubClientOptions) -> None:
        self._options = options

    @property
    def gateway_url(self) -> str:
        """Gateway URL the client was constructed with."""
        return self._options.gateway_url
