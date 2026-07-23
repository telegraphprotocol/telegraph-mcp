# Architecture

The Telegraph MCP Server exposes Telegraph protocol AI inference as MCP tools with automatic x402 micropayments.

## MCP Protocol

The server implements the Model Context Protocol (MCP) — JSON-RPC 2.0 over stdio — enabling any MCP-compatible AI agent to use Telegraph's miner network.

## Tool Categories

| Category | Endpoint | Tools |
|---|---|---|
| **Node** | Telegraph node (`:7044`) | `telehealth`, `telegraph_status`, `list_subnets`, `list_collectors` |
| **Engine** | Engine API (`:7044/engine`) | `ask_telegraph`, `direct_ask`, `list_intents`, `get_intent_detail`, `get_intent_miners` |
| **Daemon** | Daemon API (`:7044/daemon`) | `daemon_health`, `list_categories`, `get_category_questions` |
| **Explorer** | Explorer API | `get_miners`, `get_miner`, `search_signals`, `get_signal` |

## x402 Payment

Every engine inference call is automatically paid via x402:

1. Server receives 402 challenge from Telegraph node
2. Signs an EIP-3009 permit with the configured private key
3. Submits payment through the PayAI facilitator
4. Retries the request with the payment header

The private key is held by the MCP server (local custody) — no seed phrases, no browser extensions. The agent never sees payment details.

## Client Integrations

The MCP server ships with example configurations for:

| Client | Config File |
|---|---|
| Claude Desktop | `examples/claude/` |
| Cursor | `examples/cursor/` |
| ElizaOS | `examples/elizaos-telegraph/` |
| LangChain | `examples/langchain/` |
| OpenClaw | `examples/openclaw/` |
| Goose | `examples/goose/` |
| VS Code Continue | `examples/vscode-continue/` |
| Pure MCP | `examples/pure-mcp/` |
