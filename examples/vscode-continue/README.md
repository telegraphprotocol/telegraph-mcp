# VS Code Continue + Telegraph MCP

1. Set up once: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`.
2. Copy [`telegraph.yaml`](./telegraph.yaml) to `.continue/mcpServers/telegraph.yaml` at the top of your workspace.
3. Switch Continue to **Agent** mode (MCP tools only work there) and ask: "What is the BTC price? Use Telegraph."

No key goes in the config: the server uses the wallet from step 1.
