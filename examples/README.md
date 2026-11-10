# Telegraph MCP — Framework Examples

Setup for the nine integrations on the Anjoman Integrations page. Every one runs the server on your own computer over stdio: no server to host and no key in any config.

## The nine integrations

| Integration | Directory | How it was checked |
|-------------|-----------|--------------------|
| **Claude Desktop** | [`claude/`](./claude/) | Config from `install claude-desktop`, server started from it. Not opened in the app. |
| **Cursor** | [`cursor/`](./cursor/) | Config from `install cursor`, server started from it. Not opened in the app. |
| **Claude Code** | none: `claude mcp add --scope user telegraph -- npx -y @telegraphprotocol/telegraph-protocol-mcp` | `claude mcp list` shows it connected. |
| **Continue** | [`vscode-continue/`](./vscode-continue/) | Passes Continue's own config schema, server started from it. Not opened in the app. |
| **Goose** | [`goose/`](./goose/) | Fields match Goose's config type, server started from it. Not opened in the app. |
| **OpenClaw** | [`openclaw/`](./openclaw/) | `openclaw mcp add` and `doctor --probe` pass, tools listed. |
| **LangChain** | [`langchain/`](./langchain/) | `agent.py` runs, free tools answer through `langchain-mcp-adapters`. |
| **ElizaOS** | [`elizaos-telegraph/`](./elizaos-telegraph/) | `character.ts` loaded by `@elizaos/plugin-mcp`, server connected, 8 tools. |
| **Any MCP client** | [`pure-mcp/`](./pure-mcp/) | `test_mcp.py` lists the tools and calls a free one. |

## Quick Start

1. **Set up once** (any folder):
   ```bash
   npx -y @telegraphprotocol/telegraph-protocol-mcp setup
   ```
   It makes a wallet just for Telegraph, funds its escrow after you confirm, and can add the server to your app. No config below needs a key.

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
    │ HTTP, paid from escrow
    │
    ▼
Telegraph Node / Engine / Daemon  ←  running at devnode.telegraphprotocol.com
```

The framework connects to the Telegraph MCP server as an **MCP client**. The MCP server signs every escrow payment itself: the framework and its model never see the key, which stays in `~/.telegraph/wallet.json`.
