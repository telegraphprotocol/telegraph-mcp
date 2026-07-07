# OpenClaw + Telegraph

Connect OpenClaw to Telegraph's decentralized AI inference network — weather forecasting, deepfake detection, LLM inference, AI-text detection, signal feeds — with x402 USDC micropayments handled transparently by the MCP server.

OpenClaw has native MCP support, so this takes two steps: register the MCP server, then install the skill.

## 1. Add the MCP server

Merge [`openclaw.config.json`](./openclaw.config.json) into `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "telegraph": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "telegraph-protocol-mcp"],
      "env": {
        "TELEGRAPH_NODE_URL": "http://13.237.89.59:7044",
        "TELEGRAPH_ENGINE_URL": "http://13.237.89.59:8080",
        "TELEGRAPH_DAEMON_URL": "http://13.237.89.59:8081",
        "TELEGRAPH_EVM_PRIVATE_KEY": "0xyour_burner_wallet_key"
      }
    }
  }
}
```

Replace `0xyour_burner_wallet_key` with a **burner wallet** private key funded with a small amount of USDC on Base Sepolia (testnet USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`).

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

> List the available Telegraph miners

It should call `tg_node_list_subnets` (free, no payment) and return the live miner catalog. Then try a paid call:

> Get a 7-day weather forecast for Dubai via Telegraph

## Security model

- The private key lives only in the MCP server's process environment. OpenClaw and the LLM never see it — it never appears in tool inputs, outputs, or model context. Only signed x402 payment authorizations leave the machine.
- Use a burner wallet funded with only the USDC you intend to spend. Typical cost is $0.01–$0.05 per paid inference call; discovery/health/signal-feed tools are free.
- Defaults point at Base Sepolia testnet.
