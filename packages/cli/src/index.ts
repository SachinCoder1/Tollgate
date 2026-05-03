/**
 * keeperhub-publish — CLI entrypoint.
 *
 * Subcommands:
 *   publish <workflowId>       (default verb when first arg looks like wf_*)
 *   status  <workflowId>
 *   list
 *   unpublish <workflowId>
 *
 * The bare form `keeperhub-publish wf_abc --price 0.02 ...` dispatches to
 * `publish` so authors can think of it as a single verb.
 */

import { Command } from "commander";

import { runList } from "./commands/list.js";
import { runPublish } from "./commands/publish.js";
import { runStatus } from "./commands/status.js";
import { runUnpublish } from "./commands/unpublish.js";
import { KeepertollCliError } from "./errors.js";
import { renderError } from "./format.js";

const VERSION = "0.1.0";

const KNOWN_SUBCOMMANDS = new Set(["publish", "status", "list", "unpublish", "help"]);
// Accept both KeeperHub's bare 16+-char IDs and our earlier `wf_…` convention.
const WORKFLOW_ID_RX = /^(wf_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{16,64})$/u;

interface PublishOpts {
  price: string;
  currency: string;
  chain: string;
  payTo?: string;
  description?: string;
  gatewayUrl?: string;
  adminToken?: string;
  keeperhubApiKey?: string;
  keeperhubApiBase?: string;
  dryRun?: boolean;
  json?: boolean;
  skipValidation?: boolean;
  verbose?: boolean;
}

interface ManageOpts {
  gatewayUrl?: string;
  adminToken?: string;
  json?: boolean;
  verbose?: boolean;
}

interface UnpublishOpts extends ManageOpts {
  yes?: boolean;
}

function buildProgram(stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Command {
  const program = new Command();
  program
    .name("keeperhub-publish")
    .description("Publish KeeperHub workflows as x402-paid HTTP endpoints.")
    .version(VERSION)
    .showHelpAfterError();

  // Hide commander's default exit-on-error so errors flow through `run()`.
  program.exitOverride();

  program
    .command("publish")
    .description("Register a workflow as an x402-paid endpoint on the gateway.")
    .argument("<workflowId>", "KeeperHub workflow id (wf_...)")
    .requiredOption("--price <decimal>", "Price per call (e.g. 0.02)")
    .option("--currency <currency>", "Payment currency", "USDC")
    .option("--chain <chain>", "Payment chain", "base-sepolia")
    .option("--pay-to <address>", "Address that receives USDC (default: $X402_PAY_TO)")
    .option("--description <string>", "Optional human description, shown in 402 challenge")
    .option(
      "--gateway-url <url>",
      "Gateway base URL (default: $GATEWAY_PUBLIC_URL or http://localhost:3030)",
    )
    .option("--admin-token <token>", "Gateway admin bearer token (default: $GATEWAY_ADMIN_TOKEN)")
    .option("--keeperhub-api-key <key>", "KeeperHub API key (default: $KEEPERHUB_API_KEY)")
    .option("--keeperhub-api-base <url>", "KeeperHub REST base (default: $KEEPERHUB_API_BASE)")
    .option("--dry-run", "Validate inputs but do not call the gateway")
    .option("--json", "Emit a single JSON object on stdout instead of human text")
    .option("--skip-validation", "Skip the KeeperHub ownership precheck")
    .option("--verbose", "Verbose stderr logging")
    .action(async (workflowId: string, opts: PublishOpts) => {
      await runPublish({ workflowId, flags: opts, stdout });
    });

  program
    .command("status")
    .description("Show the gateway-side state of a published workflow.")
    .argument("<workflowId>", "KeeperHub workflow id (wf_...)")
    .option("--gateway-url <url>", "Gateway base URL")
    .option("--admin-token <token>", "Gateway admin bearer token")
    .option("--json", "Emit JSON on stdout")
    .option("--verbose", "Verbose stderr logging")
    .action(async (workflowId: string, opts: ManageOpts) => {
      await runStatus({ workflowId, flags: opts, stdout });
    });

  program
    .command("list")
    .description("List all workflows registered on the gateway.")
    .option("--gateway-url <url>", "Gateway base URL")
    .option("--admin-token <token>", "Gateway admin bearer token")
    .option("--json", "Emit JSON on stdout")
    .option("--verbose", "Verbose stderr logging")
    .action(async (opts: ManageOpts) => {
      await runList({ flags: opts, stdout });
    });

  program
    .command("unpublish")
    .description("Remove a workflow from the gateway registry.")
    .argument("<workflowId>", "KeeperHub workflow id (wf_...)")
    .option("--yes", "Skip the confirmation prompt")
    .option("--gateway-url <url>", "Gateway base URL")
    .option("--admin-token <token>", "Gateway admin bearer token")
    .option("--json", "Emit JSON on stdout")
    .option("--verbose", "Verbose stderr logging")
    .action(async (workflowId: string, opts: UnpublishOpts) => {
      await runUnpublish({ workflowId, flags: opts, stdout });
    });

  return program;
}

/**
 * Run the CLI with parsed argv (i.e. process.argv.slice(2)).
 *
 * @returns Process exit code.
 */
export async function run(argv: readonly string[]): Promise<number> {
  const stdout = process.stdout;
  const stderr = process.stderr;

  // Bare form: `keeperhub-publish wf_xxx --price ...` → dispatch to publish.
  const adjusted =
    argv.length > 0 && WORKFLOW_ID_RX.test(argv[0] ?? "") && !KNOWN_SUBCOMMANDS.has(argv[0] ?? "")
      ? ["publish", ...argv]
      : [...argv];

  const program = buildProgram(stdout, stderr);

  try {
    await program.parseAsync(adjusted, { from: "user" });
    return 0;
  } catch (err: unknown) {
    if (err instanceof KeepertollCliError) {
      stderr.write(renderError(err));
      return err.exitCode;
    }
    // commander throws CommanderError on bad usage; render its message and
    // exit with its code.
    if (err && typeof err === "object" && "code" in err && "exitCode" in err) {
      const e = err as { code: string; message: string; exitCode: number };
      // version/help happen via process.exit and don't reach here, but in
      // case they do, treat them as success.
      if (e.code.startsWith("commander.help") || e.code === "commander.version") {
        return 0;
      }
      if (e.message) stderr.write(`${e.message}\n`);
      return typeof e.exitCode === "number" ? e.exitCode : 1;
    }
    stderr.write(renderError(err));
    return 1;
  }
}

export default run;
