/**
 * `keeperhub-publish unpublish <workflowId> [--yes]` — remove a workflow
 * from the gateway. Without --yes, refuses to act in non-TTY environments
 * (CI scripts must opt in explicitly).
 */

import { type ManageFlags, resolveManage } from "../config.js";
import { ConfirmationRequiredError } from "../errors.js";
import { jsonLine } from "../format.js";
import { GatewayClient } from "../gateway-client.js";

export interface UnpublishCommandArgs {
  workflowId: string;
  flags: ManageFlags & { yes?: boolean };
  stdout: NodeJS.WritableStream;
}

export async function runUnpublish(args: UnpublishCommandArgs): Promise<void> {
  const cfg = resolveManage(args.flags);
  if (args.flags.yes !== true) {
    throw new ConfirmationRequiredError(`unpublish ${args.workflowId}`);
  }
  const gw = new GatewayClient({ baseUrl: cfg.gatewayUrl, adminToken: cfg.adminToken });
  await gw.unpublishWorkflow(args.workflowId);
  if (cfg.json) {
    args.stdout.write(jsonLine({ workflowId: args.workflowId, unpublished: true }));
  } else {
    args.stdout.write(`✓ Unpublished ${args.workflowId}\n`);
  }
}
