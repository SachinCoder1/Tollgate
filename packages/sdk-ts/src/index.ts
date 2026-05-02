/**
 * `@keepertoll/client` — TypeScript SDK for callers of x402-paid KeeperHub
 * workflows.
 *
 * Phase 1 stub: surface only. The real implementation (wallet signing, x402
 * payment retry, budget tracking, polling) lands in Phase 3.
 */

/**
 * Construction options for {@link KeeperHubClient}.
 *
 * Field shapes are intentionally minimal at Phase 1; they will be expanded
 * once the gateway contract is finalised in Phase 2.
 */
export interface KeeperHubClientOptions {
  /** Base URL of a keepertoll gateway, e.g. `http://localhost:3030`. */
  gatewayUrl: string;
}

/**
 * Client for discovering and calling paid KeeperHub workflows through a
 * keepertoll gateway.
 *
 * Phase 1: methods are not yet implemented and will throw.
 *
 * @example
 *   const client = new KeeperHubClient({ gatewayUrl: "http://localhost:3030" });
 */
export class KeeperHubClient {
  readonly #options: KeeperHubClientOptions;

  constructor(options: KeeperHubClientOptions) {
    this.#options = options;
  }

  /** Gateway URL the client was constructed with. */
  get gatewayUrl(): string {
    return this.#options.gatewayUrl;
  }
}

export default KeeperHubClient;
