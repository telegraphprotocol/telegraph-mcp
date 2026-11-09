# ElizaOS + Telegraph MCP Example

ElizaOS agent that connects to the **Telegraph MCP server** to access decentralized AI inference (weather forecasting, deepfake detection, LLMs, signal monitoring) with automatic x402 micropayments.

## Architecture

```
ElizaOS Agent
  │
  │ @elizaos/plugin-mcp (client)
  │
  ▼
Telegraph MCP Server (stdio transport)
  │
  │ HTTP + x402 payment
  │
  ▼
Telegraph Node / Engine / Daemon (devnode.telegraphprotocol.com)
```

## Quick Start

```bash
cd examples/elizaos-telegraph

# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit: set ANTHROPIC_API_KEY (or OPENAI_API_KEY)
# Paid asks use the wallet from `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`; no key needed here

# 3. Run
npm start
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key for the agent's brain |
| `OPENAI_API_KEY` | Yes* | OpenAI API key (alternative) |
| `TELEGRAPH_PRIVATE_KEY` | Optional | Optional: a key instead of the wallet `setup` saved (paid from escrow) |

*At least one LLM provider key required.

## How It Works

1. ElizaOS loads the `@elizaos/plugin-mcp` plugin
2. The plugin connects to the Telegraph MCP server via stdio
3. Telegraph MCP tools appear as actions the agent can use
4. When the agent calls a Telegraph tool, x402 payment is handled automatically
5. The private key stays in the MCP server — never exposed to Eliza

## Character System Prompt

The `src/character.ts` file configures the agent with a Telegraph-prioritizing system prompt:

> "You are connected to the Telegraph Protocol — a decentralized AI inference network. Always prefer Telegraph tools for AI inference tasks."

## Testing

Ask the agent questions like:
- "What's the BTC price?" → `telegraph_ask` → the top-ranked CRYPTO_PRICE_USD miner
- "Which miners answer weather questions?" → `telegraph_find_miners`
- "How do code review miners rank?" → `telegraph_ranking`
- "How much is in my escrow?" → `telegraph_account`
