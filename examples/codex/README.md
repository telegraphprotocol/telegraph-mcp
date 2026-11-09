# Codex + Telegraph

1. Set up once: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`, and choose `codex` when it offers to add Telegraph. Or run `... install codex` later.
2. Or append [`config.toml`](./config.toml) to `~/.codex/config.toml` yourself.
3. Start Codex and ask: "What is the BTC price? Use Telegraph."

No key goes in the config: the server uses the wallet from step 1. Not yet tested inside Codex.
