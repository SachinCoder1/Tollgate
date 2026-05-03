/**
 * Output formatters. Default is human-readable text with chalk colors when
 * stdout is a TTY. `--json` switches to a single JSON object on stdout.
 */

import chalk from "chalk";

import { KeepertollCliError } from "./errors.js";

const useColor = (): boolean => process.stdout.isTTY === true && !("NO_COLOR" in process.env);

const c = {
  green: (s: string) => (useColor() ? chalk.green(s) : s),
  cyan: (s: string) => (useColor() ? chalk.cyan(s) : s),
  yellow: (s: string) => (useColor() ? chalk.yellow(s) : s),
  red: (s: string) => (useColor() ? chalk.red(s) : s),
  dim: (s: string) => (useColor() ? chalk.dim(s) : s),
  bold: (s: string) => (useColor() ? chalk.bold(s) : s),
};

export interface PublishedSummary {
  workflowId: string;
  endpointUrl: string;
  price: string;
  currency: string;
  network: string;
  payTo: string;
  description?: string;
  registeredAt: string;
  gatewayUrl: string;
}

export function renderPublished(s: PublishedSummary, validated: boolean): string {
  const lines: string[] = [];
  if (validated) {
    lines.push(`${c.green("✓")} Validated workflow ${c.cyan(s.workflowId)} (you have access)`);
  } else {
    lines.push(`${c.yellow("•")} Skipped KeeperHub ownership precheck (--skip-validation)`);
  }
  lines.push(`${c.green("✓")} Registered with gateway at ${c.cyan(s.gatewayUrl)}`);
  lines.push(`${c.green("✓")} Endpoint live:`);
  lines.push("");
  lines.push(`   ${c.bold("POST")} ${c.cyan(s.endpointUrl)}`);
  lines.push(`   ${c.dim("price")} : ${s.price} ${s.currency} on ${s.network}`);
  lines.push(`   ${c.dim("payTo")} : ${shortAddr(s.payTo)}`);
  if (s.description) lines.push(`   ${c.dim("desc ")} : ${s.description}`);
  lines.push("");
  lines.push(`Pay this endpoint with ${c.cyan("@x402/fetch")} or any x402-compatible client.`);
  lines.push(`Status: ${c.cyan(`keeperhub-publish status ${s.workflowId}`)}`);
  return `${lines.join("\n")}\n`;
}

export function renderDryRun(s: PublishedSummary): string {
  return [
    `${c.yellow("◌")} dry-run: would register the following:`,
    "",
    `   workflowId : ${s.workflowId}`,
    `   endpoint   : ${s.endpointUrl}`,
    `   price      : ${s.price} ${s.currency}`,
    `   network    : ${s.network}`,
    `   payTo      : ${s.payTo}`,
    s.description ? `   description: ${s.description}` : "",
    `   gateway    : ${s.gatewayUrl}`,
    "",
    "No request was sent. Drop --dry-run to publish.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface RegisteredRow {
  workflowId: string;
  endpointUrl: string;
  price: string;
  currency: string;
  network: string;
  payTo: string;
  registeredAt: string;
}

export function renderList(rows: RegisteredRow[]): string {
  if (rows.length === 0) {
    return `${c.dim("(no workflows registered)")}\n`;
  }
  const lines = [c.bold(`${rows.length} workflow${rows.length === 1 ? "" : "s"} registered:`), ""];
  for (const r of rows) {
    lines.push(`  ${c.cyan(r.workflowId)}  ${r.price} ${r.currency} (${r.network})`);
    lines.push(`    ${c.dim(r.endpointUrl)}`);
    lines.push(`    ${c.dim(`payTo ${shortAddr(r.payTo)}  registered ${r.registeredAt}`)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderError(err: unknown): string {
  if (err instanceof KeepertollCliError) {
    const head = `${c.red("✗")} ${c.bold(err.code)}: ${err.message}`;
    if (err.details !== undefined) {
      return `${head}\n${c.dim(JSON.stringify(err.details, null, 2))}\n`;
    }
    return `${head}\n`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `${c.red("✗")} ${message}\n`;
}

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function shortAddr(addr: string): string {
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
