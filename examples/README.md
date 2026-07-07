# Telegraph MCP — Framework Examples

Ready-to-run examples connecting popular AI frameworks to the Telegraph decentralized AI inference network via MCP.

Each example is self-contained with its own `package.json` / `requirements.txt`, `.env.example`, and `README.md`.

## Available Examples

| Framework | Directory | Type | Status | Notes |
|-----------|-----------|------|--------|-------|
| **LangChain** | [`langchain/`](./langchain/) | Python agent | ✅ Tested | `langchain-mcp-adapters`, 19 tools loaded, x402 payments working |
| **Pure MCP** | [`pure-mcp/`](./pure-mcp/) | Python script | ✅ Tested | Raw MCP SDK test — validates server for any client |
| **Claude Desktop** | [`claude/`](./claude/) | Config | ✅ Ready | `claude_desktop_config.json` — copy to Claude settings |
| **Cursor** | [`cursor/`](./cursor/) | Config | ✅ Ready | `cursor_mcp_config.json` — paste into Cursor MCP settings |
| **OpenClaw** | [`openclaw/`](./openclaw/) | Config + Skill | ✅ Ready | npx `mcpServers` entry for `~/.openclaw/openclaw.json` + config-gated skill ([`skills/telegraph`](../skills/telegraph/)) |
| **Goose** | [`goose/`](./goose/) | Config | ✅ Ready | `config.yaml` — copy to `~/.config/goose/` |
| **VS Code Continue** | [`vscode-continue/`](./vscode-continue/) | Config | ✅ Ready | `config.json` — merge into Continue settings |
| **ElizaOS** | [`elizaos-telegraph/`](./elizaos-telegraph/) | TypeScript | ✅ Tested | Full agent with `@elizaos/plugin-mcp`. 19 tools loaded, x402 working. |

## Tested ✅ = MCP connection works, tools discovered, free + paid tool calls succeed
## Ready ✅ = Config files created with correct env vars. Desktop app needed to fully test.

## Quick Start

1. **Set up the MCP server** (from repo root):
   ```bash
   npm install && npm run build
   cp .env.example .env
   # Edit .env: set TELEGRAPH_EVM_PRIVATE_KEY
   ```

2. **Run the LangChain or Pure MCP test**:
   ```bash
   cd examples/langchain      # Python agent with memory
   # or
   cd examples/pure-mcp       # Raw MCP SDK validation
   ```

3. **For desktop apps** (Claude, Cursor, etc.), copy the config from the relevant folder into your app's MCP settings. See each folder's `README.md`.

## Architecture

All examples follow the same pattern:

```
AI Framework (LangChain / Claude / Cursor / etc.)
    │
    │ MCP protocol (stdio)
    │
    ▼
Telegraph MCP Server  ←  you run this alongside the framework
    │
    │ HTTP + x402 payment
    │
    ▼
Telegraph Node / Engine / Daemon  ←  running at 13.237.89.59
```

The framework connects to the Telegraph MCP server as an **MCP client**. The MCP server handles all x402 payment signing internally — the framework and its LLM never see the private key.

## Framework Integration Reference

| Framework | MCP Library/Plugin | Transport | Test Status |
|-----------|-------------------|-----------|-------------|
| LangChain | `langchain-mcp-adapters` | stdio | ✅ Tested — 19 tools, x402 working |
| Pure MCP | `mcp` (Python SDK) | stdio | ✅ Tested — 19 tools, x402 working |
| Claude Desktop | Built-in MCP support | stdio | ✅ Config ready |
| Cursor | Built-in MCP support | stdio | ✅ Config ready |
| OpenClaw | `mcpServers` config | stdio | ✅ Config ready |
| Goose | `extensions` config | stdio | ✅ Config ready |
| VS Code Continue | `modelContextProtocolServers` | stdio | ✅ Config ready |
| ElizaOS | `@elizaos/plugin-mcp` (v1.7.1) | stdio | ✅ Tested — 19 tools, x402 working |
