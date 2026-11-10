/**
 * ElizaOS + Telegraph MCP Client
 *
 * Connects to the Telegraph MCP server as an MCP client and tests all tool categories.
 * Uses @modelcontextprotocol/sdk directly — no Eliza runtime needed for tool testing.
 *
 * For Eliza agent integration, see character.ts
 */

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = resolve(__dirname, "../../../dist/index.js");

function childEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") base[k] = v;
  }
  return base;
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   ElizaOS + Telegraph MCP — Tool Test Client     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [MCP_ENTRY],
    env: childEnv(),
  });

  const client = new Client(
    { name: "elizaos-telegraph", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    console.log("Connecting to Telegraph MCP server...");
    await client.connect(transport);
    console.log("✅ Connected!\n");

    // ── List all tools ──────────────────────────────────────────────
    const { tools } = await client.listTools();
    console.log(`📋 ${tools.length} tools available:\n`);
    console.log(`  ${tools.map((t) => t.name).join(", ")}`);

    // ── Test free tools ────────────────────────────────────────────
    console.log("\n── Testing free tools ──\n");

    const freeTools = [
      ["telegraph_find_intents", { search: "weather" }, "Find intents"],
      ["telegraph_ranking", { intent: "CRYPTO_PRICE_USD", limit: 3 }, "Ranking"],
      ["telegraph_find_miners", { intent: "CRYPTO_PRICE_USD", limit: 3 }, "Miners"],
      ["telegraph_docs", {}, "Docs"],
    ];

    for (const [name, args, label] of freeTools) {
      try {
        const result = await client.callTool({ name: name as string, arguments: args as any });
        const text = result.content?.map((c: any) => c.text || "").join("") || "";
        console.log(`✅ ${label}: ${text.substring(0, 120)}...`);
      } catch (err: any) {
        console.log(`❌ ${label}: ${err.message?.substring(0, 80)}`);
      }
    }

    // ── Test a paid ask ────────────────────────────────────────────
    console.log("\n── Testing a paid ask ──\n");

    try {
      const result = await client.callTool({
        name: "telegraph_ask",
        arguments: { question: "What is the BTC price in USD?" },
      });
      const text = result.content?.map((c: any) => c.text || "").join("") || "";
      console.log(`✅ Ask: ${text.substring(0, 200)}...`);
    } catch (err: any) {
      console.log(`⚠️  Ask (needs the wallet from setup): ${err.message?.substring(0, 100)}`);
    }

    console.log("\n✅ All tests complete!");
    console.log("\nTo use with Eliza agent: set up character.ts with @elizaos/plugin-mcp");
    console.log("See README.md for integration instructions.\n");

  } catch (err: any) {
    console.error("❌ Fatal:", err.message);
    process.exit(1);
  } finally {
    await transport.close();
  }
}

main();
