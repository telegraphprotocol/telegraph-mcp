# Hermes Agent + Telegraph

1. Set up once: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`. This makes a wallet and funds its escrow after you confirm.
2. Merge [`config.yaml`](./config.yaml) into `~/.hermes/config.yaml`. Hermes reads MCP servers from its `mcp_servers` block.
3. Run `/reload-mcp` in a chat, or restart Hermes. The tools appear with Hermes's `mcp_telegraph_` prefix.

Then ask: "What is the BTC price? Use Telegraph."

No key goes in the config: the server uses the wallet from step 1. Format from the [Hermes Agent MCP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp). Not yet tested inside Hermes.
