/**
 * Reference agent — Phase 1 sanity check.
 *
 * Imports `@keepertoll/client`, constructs a client, and prints a banner.
 * In Phase 4 this becomes a real demo: it calls the reference workflow
 * `MultiChainAaveHealth` through the gateway and pays $0.02 per call.
 */

import { KeeperHubClient } from "@keepertoll/client";

const gatewayUrl = process.env["GATEWAY_PUBLIC_URL"] ?? "http://localhost:3030";

const client = new KeeperHubClient({ gatewayUrl });

process.stdout.write(`agent ready — gateway=${client.gatewayUrl}\n`);
