# Goose + Telegraph MCP

1. Set up once: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`.
2. Add the `telegraph` entry from [`config.yaml`](./config.yaml) under `extensions:` in `~/.config/goose/config.yaml`. Don't replace the file: it holds your other settings.
3. Start a new Goose session and ask: "What is the BTC price? Use Telegraph."

No key goes in the config: the server uses the wallet from step 1.
