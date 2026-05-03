/**
 * `keeperhub-publish [publish] <workflowId>` — register a workflow as an
 * x402-paid endpoint on the gateway.
 */

import { type PublishFlags, resolvePublish } from "../config.js";
import { type PublishedSummary, jsonLine, renderDryRun, renderPublished } from "../format.js";
import { GatewayClient } from "../gateway-client.js";
import { KeeperHubCliClient } from "../keeperhub-client.js";

export interface PublishCommandArgs {
  workflowId: string;
  flags: PublishFlags;
  stdout: NodeJS.WritableStream;
}

export async function runPublish(args: PublishCommandArgs): Promise<number> {
  const cfg = resolvePublish(args.workflowId, args.flags);

  const summary: PublishedSummary = {
    workflowId: cfg.workflowId,
    endpointUrl: `${cfg.gatewayUrl}/run/${cfg.workflowId}`,
    price: cfg.price,
    currency: cfg.currency,
    network: cfg.chain,
    payTo: cfg.payTo,
    ...(cfg.description !== undefined ? { description: cfg.description } : {}),
    registeredAt: new Date().toISOString(),
    gatewayUrl: cfg.gatewayUrl,
  };

  if (cfg.dryRun) {
    if (cfg.json) {
      args.stdout.write(jsonLine({ ...summary, dryRun: true }));
    } else {
      args.stdout.write(renderDryRun(summary));
    }
    return 0;
  }

  let validated = false;
  if (!cfg.skipValidation) {
    const kh = new KeeperHubCliClient({
      apiBase: cfg.keeperhubApiBase,
      apiKey: cfg.keeperhubApiKey,
    });
    await kh.getWorkflow(cfg.workflowId);
    validated = true;
  }

  const gw = new GatewayClient({ baseUrl: cfg.gatewayUrl, adminToken: cfg.adminToken });
  const registered = await gw.registerWorkflow({
    workflowId: cfg.workflowId,
    price: cfg.price,
    currency: "USDC",
    network: cfg.chain,
    payTo: cfg.payTo,
    ...(cfg.description !== undefined ? { description: cfg.description } : {}),
    keeperhubApiKey: cfg.keeperhubApiKey,
    keeperhubApiBase: cfg.keeperhubApiBase,
  });

  const finalSummary: PublishedSummary = {
    workflowId: registered.workflowId,
    endpointUrl: registered.endpointUrl,
    price: registered.price,
    currency: registered.currency,
    network: registered.network,
    payTo: registered.payTo,
    ...(registered.description !== undefined ? { description: registered.description } : {}),
    registeredAt: registered.registeredAt,
    gatewayUrl: cfg.gatewayUrl,
  };

  if (cfg.json) {
    args.stdout.write(jsonLine({ ...finalSummary, validated }));
  } else {
    args.stdout.write(renderPublished(finalSummary, validated));
  }
  return 0;
}
