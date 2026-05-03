/**
 * `keeperhub-publish list` — list all workflows registered on the gateway.
 */

import { type ManageFlags, resolveManage } from "../config.js";
import { jsonLine, renderList } from "../format.js";
import { GatewayClient } from "../gateway-client.js";

export interface ListCommandArgs {
  flags: ManageFlags;
  stdout: NodeJS.WritableStream;
}

export async function runList(args: ListCommandArgs): Promise<number> {
  const cfg = resolveManage(args.flags);
  const gw = new GatewayClient({ baseUrl: cfg.gatewayUrl, adminToken: cfg.adminToken });
  const rows = await gw.listWorkflows();
  if (cfg.json) {
    args.stdout.write(jsonLine({ workflows: rows }));
  } else {
    args.stdout.write(renderList(rows));
  }
  return 0;
}
