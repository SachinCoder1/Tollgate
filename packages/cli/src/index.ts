/**
 * keeperhub-publish — CLI entrypoint.
 *
 * Phase 1 stub: prints the placeholder help text and exits zero.
 * Real subcommands (init, publish, status, list, unpublish) ship in Phase 2.
 */

const HELP_TEXT = `keeperhub-publish — publish KeeperHub workflows as x402-paid endpoints

Usage:
  keeperhub-publish <command> [options]

Commands (Phase 2 — not yet implemented):
  init          Register a workflow ID + price with the gateway.
  publish       Open the registered route on the gateway.
  status        Show the gateway-side state of a workflow.
  list          List workflows the current author has registered.
  unpublish     Remove a workflow from the gateway.

Global flags:
  --help, -h    Show this help.
  --version     Show the CLI version.

This is a Phase 1 bootstrap stub. See CLAUDE.md for the full plan.
`;

const VERSION = "0.0.0";

/**
 * Run the CLI with parsed argv (i.e. process.argv.slice(2)).
 *
 * @param argv - Argument list, excluding node and script name.
 * @returns Process exit code.
 *
 * @example
 *   const code = await run(["--help"]); // prints help, returns 0
 */
export async function run(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  process.stderr.write(
    `keeperhub-publish: command not implemented yet. Run with --help to see the planned surface.\n`,
  );
  return 1;
}

export default run;
