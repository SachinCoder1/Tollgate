/**
 * `keeperhub-publish status <workflowId>` — show the gateway-side state of a
 * published workflow.
 */

import { type ManageFlags, resolveManage } from "../config.js";
import { jsonLine, renderList } from "../format.js";
import { GatewayClient } from "../gateway-client.js";

export interface StatusCommandArgs {
  workflowId: string;
  flags: ManageFlags;
  stdout: NodeJS.WritableStream;
}

export async function runStatus(args: StatusCommandArgs): Promise<number> {
  const cfg = resolveManage(args.flags);
  const gw = new GatewayClient({ baseUrl: cfg.gatewayUrl, adminToken: cfg.adminToken });
  const wf = await gw.getWorkflow(args.workflowId);
  if (cfg.json) {
    args.stdout.write(jsonLine(wf));
  } else {
    args.stdout.write(renderList([wf]));
  }
  return 0;
}
