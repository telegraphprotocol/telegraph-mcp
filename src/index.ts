#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const INSTRUCTIONS =
  "Telegraph is a network of miners (APIs and models) that answer questions by intent, ranked every epoch by the " +
  "network's own checks. Use telegraph_ask for live facts (prices, FX, weather, search) and specialist answers " +
  "(security, code review, compliance); payment from the user's Telegraph escrow is automatic. " +
  "telegraph_find_intents, telegraph_intent, telegraph_find_miners and telegraph_ranking are free. " +
  "telegraph_account shows the balances and how the user tops up; telegraph_docs explains payments and errors.";

async function main() {
  // A person running a command (setup, fund, status, install); with none, an MCP client is starting the server.
  const args = process.argv.slice(2);
  if (args.length || process.stdin.isTTY) {
    const { runCli } = await import("./cli.js");
    process.exit(await runCli(args));
  }
  const cfg = loadConfig();
  const server = new McpServer({ name: "telegraph", version }, { instructions: INSTRUCTIONS });
  const payer = registerTools(server, cfg);
  await server.connect(new StdioServerTransport());
  console.error(
    `[telegraph-mcp] v${version} on ${cfg.url}; wallet ${payer?.account.address ?? "none (free tools only)"}; payment ${cfg.payment}`,
  );
}

main().catch((err) => {
  console.error(`[telegraph-mcp] ${err?.message || err}`);
  process.exit(1);
});
