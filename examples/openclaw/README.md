# OpenClaw + Telegraph

Connect OpenClaw to the Telegraph network: ranked miners for prices, FX, weather, search, security, code review and 100+ other intents, paid per ask in USDC (escrow first, then x402) by the MCP server.

OpenClaw has native MCP support, so this takes two steps: register the MCP server, then install the skill.

## 1. Add the MCP server

Merge [`openclaw.config.json`](./openclaw.config.json) into `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "telegraph": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@telegraphprotocol/telegraph-protocol-mcp"],
      "env": {
        "TELEGRAPH_PRIVATE_KEY": "0xyour_burner_wallet_key"
      }
    }
  }
}
```

Replace `0xyour_burner_wallet_key` with a **burner wallet** private key holding a little USDC on the Telegraph network. Beta 2 runs on Ethereum Sepolia; its test USDC is `0xcc194e1a843B658526D0D5C431f670028582Ae17` (see the main README for test funds). Without a key, the free tools still work.

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

- The private key lives only in the MCP server's process environment. OpenClaw and the LLM never see it — it never appears in tool inputs, outputs, or model context. Only signed x402 payment authorizations leave the machine.
- Use a burner wallet funded with only the USDC you intend to spend. An ask usually costs $0.01; the discovery, ranking, account and docs tools are free.
- Defaults point at Telegraph beta 2 on Ethereum Sepolia (testnet).
