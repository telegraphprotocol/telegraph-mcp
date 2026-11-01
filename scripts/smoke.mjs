// Starts the built server over stdio like an MCP client would and calls each
// tool. Paid calls run only when TELEGRAPH_PRIVATE_KEY is set.
//   node scripts/smoke.mjs            free tools
//   node scripts/smoke.mjs paid       plus three asks (about $0.03; escrow first, then x402)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: process.env, stderr: "inherit" });
const client = new Client({ name: "telegraph-smoke", version: "1" });
await client.connect(transport);

const show = async (name, args = {}) => {
  const t = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text).join("\n");
  console.log(`\n== ${name} ${JSON.stringify(args)} (${Date.now() - t} ms)${r.isError ? " ERROR" : ""}\n${text.slice(0, 1500)}`);
  return r;
};

// node scripts/smoke.mjs call <tool> '<json args>': one call, then exit.
if (process.argv[2] === "call") {
  await show(process.argv[3], JSON.parse(process.argv[4] || "{}"));
  await client.close();
  process.exit(0);
}

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
const { resources } = await client.listResources();
console.log(`resources: ${resources.map((r) => r.uri).join(", ")}`);

await show("telegraph_find_intents", { search: "bitcoin price" });
await show("telegraph_intent", { intent: "CRYPTO_PRICE_USD" });
await show("telegraph_find_miners", { intent: "CRYPTO_PRICE_USD", limit: 3 });
await show("telegraph_find_miners", { search: "weather", limit: 3 });
await show("telegraph_ranking", { intent: "CRYPTO_PRICE_USD", limit: 3 });
await show("telegraph_docs", { search: "withdraw escrow" });
if (process.env.TELEGRAPH_PRIVATE_KEY) await show("telegraph_account");
if (process.argv.includes("paid")) {
  await show("telegraph_ask", { question: "What is the BTC price in USD?" });
  await show("telegraph_ask", { intent: "CRYPTO_PRICE_USD", params: { symbol: "ETH" } });
  await show("telegraph_ask_miner", { miner: "crypto-kraken", intent: "CRYPTO_PRICE_USD", params: { symbol: "BTC" } });
}
await client.close();
