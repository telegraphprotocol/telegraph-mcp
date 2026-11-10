# Cursor + Telegraph MCP

1. Set up once: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`, and choose `cursor` when it offers to add Telegraph to your app.
2. Or merge [`cursor_mcp_config.json`](./cursor_mcp_config.json) into `~/.cursor/mcp.json` yourself.
3. Restart Cursor and ask its agent: "What is the BTC price? Use Telegraph."

No key goes in the config: the server uses the wallet from step 1.
