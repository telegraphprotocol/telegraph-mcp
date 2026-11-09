# OpenClaw + Telegraph

Connect OpenClaw to the Telegraph network: ranked miners for prices, FX, weather, search, security, code review and 100+ other intents, paid per ask in USDC from escrow by the MCP server.

OpenClaw has native MCP support. First set up once in a terminal: `npx -y @telegraphprotocol/telegraph-protocol-mcp setup` (a wallet just for Telegraph, funded after you confirm). Then register the server and install the skill.

## 1. Add the MCP server

Merge [`openclaw.config.json`](./openclaw.config.json) into `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "telegraph": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@telegraphprotocol/telegraph-protocol-mcp"]
    }
  }
}
```

No key goes here: the server uses the wallet `setup` saved.

## 2. Install the skill

From ClawHub (once published):

```bash
clawhub install telegraph
```

Or copy it from this repo into your personal skills directory:

```bash
cp -r skills/telegraph ~/.openclaw/skills/telegraph
```

The skill is **gated on the `mcpServers.telegraph` config entry** — it stays dormant (zero prompt overhead, invisible to the agent) until step 1 is done. New sessions pick it up automatically.

## 3. Verify

Ask your agent:

> Which Telegraph miners answer crypto price questions, and how do they rank?

It should call `telegraph_find_miners` or `telegraph_ranking` (free). Then try a paid call:

> What is the BTC price? Use Telegraph.

## Security model

- The key lives only in `~/.telegraph/wallet.json`, read by the MCP server. OpenClaw and the model never see it: it never appears in tool inputs, outputs or model context.
- The wallet holds only what you deposit, and the server's limits ($0.50 an ask, $5 a day by default) cap spending. An ask usually costs $0.01; the discovery, ranking, account and docs tools are free.
- Defaults point at Telegraph beta 2 on Ethereum Sepolia (testnet).
