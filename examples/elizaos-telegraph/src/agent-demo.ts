/**
 * Telegraph Agent Demo
 *
 * A simplified agent that uses the character config + OpenAI + Telegraph MCP.
 * This demonstrates the full integration without the full ElizaOS runtime.
 */

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const MCP_ENTRY = resolve(import.meta.dirname, "../../../dist/index.js");

function childEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") base[k] = v;
  }
  return base;
}

async function callOpenAI(system: string, user: string, tools: any[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   Telegraph Agent Demo — OpenAI + MCP                     ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set");
    process.exit(1);
  }

  // Connect to Telegraph MCP
  const transport = new StdioClientTransport({
    command: "node",
    args: [MCP_ENTRY],
    env: childEnv(),
  });

  const client = new Client(
    { name: "telegraph-agent-demo", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("✅ Connected to Telegraph MCP\n");

  // List tools
  const { tools } = await client.listTools();
  console.log(`📋 ${tools.length} Telegraph tools available\n`);

  // Convert MCP tools to OpenAI function format
  const openaiTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

  // System prompt from character.ts
  const systemPrompt =
    "You are the Telegraph Agent — an AI assistant connected to the Telegraph network, " +
    "where ranked miners (APIs and models) answer questions by intent.\n\n" +
    "RULES FOR USING TELEGRAPH TOOLS:\n" +
    "1. ASK: For live facts (prices, FX, weather, search) and specialist answers (security, code review, " +
    "compliance), use telegraph_ask with the question. It routes to the best-ranked miner.\n" +
    "2. DISCOVERY: telegraph_find_intents shows what can be asked, telegraph_intent an intent's params, " +
    "telegraph_find_miners and telegraph_ranking who answers and how they rank.\n" +
    "3. ONE MINER: telegraph_ask_miner asks a miner the user names.\n" +
    "4. MONEY: An ask costs about $0.01; don't mention it unless asked. telegraph_account shows balances; " +
    "telegraph_deposit tops up escrow, only after the user confirms the amount.\n\n" +
    "Always say which miner answered.";

  // Test queries
  const queries = [
    "What's the weather in Lahore?",
    "Which miners answer weather questions, and how do they rank?",
    "What is Bitcoin?",
  ];

  for (const query of queries) {
    console.log(`💬 User: ${query}`);

    const completion = await callOpenAI(systemPrompt, query, openaiTools);
    const msg = completion.choices[0].message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolCall = msg.tool_calls[0];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      console.log(`🔧 Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);

      try {
        const result = await client.callTool({ name: toolName, arguments: toolArgs });
        const text = result.content?.map((c: any) => c.text || "").join("") || "";

        // Send tool result back to OpenAI for final response
        const finalCompletion = await callOpenAI(systemPrompt, query, []);
        const response = finalCompletion.choices[0].message.content;
        console.log(`🤖 Agent: ${response}\n`);
      } catch (err: any) {
        console.log(`❌ Tool error: ${err.message}\n`);
      }
    } else {
      console.log(`🤖 Agent: ${msg.content}\n`);
    }
  }

  await transport.close();
  console.log("✅ Demo complete.");
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
