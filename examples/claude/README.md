# Claude Desktop + Telegraph MCP

1. Set up once: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`, and choose `claude-desktop` when it offers to add Telegraph to your app.
2. Or merge [`claude_desktop_config.json`](./claude_desktop_config.json) into your config yourself:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
3. Restart Claude Desktop and ask: "What is the BTC price? Use Telegraph."

No key goes in the config: the server uses the wallet from step 1.
