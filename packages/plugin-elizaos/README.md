# @telegraph/plugin-elizaos

ElizaOS plugin for the **Telegraph Protocol** — a permissionless marketplace for verifiable AI inference with x402 USDC micropayments.

## What it does

- **TELEGRAPH_ASK** — Route natural language queries through Telegraph's decentralized AI network (weather, deepfake detection, LLM chat, image generation, embeddings)
- **TELEGRAPH_LIST_MINERS** — Discover available AI miners with capabilities, endpoints, and pricing
- **TELEGRAPH_DAEMON_SIGNALS** — Query autonomous signal feeds across categories (CRYPTO, TECHNOLOGY, POLITICS, CLIMATE, etc.)
- **Context providers** — Daemon signal feed and miner catalog injected into agent context

## Install

```bash
npm install @telegraphprotocol/plugin-elizaos
```

## Setup

Add to your ElizaOS character config:

```json
{
  "name": "my-agent",
      "plugins": ["@telegraphprotocol/plugin-elizaos"],
  "settings": {
    "secrets": {
      "TELEGRAPH_EVM_PRIVATE_KEY": "0xyour_burner_wallet_key"
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAPH_NODE_URL` | No | Node API URL (default: `http://13.237.89.59:7044`) |
| `TELEGRAPH_ENGINE_URL` | No | Engine API URL (default: `http://13.237.89.59:8080`) |
| `TELEGRAPH_DAEMON_URL` | No | Daemon API URL (default: `http://13.237.89.59:8081`) |
| `TELEGRAPH_EVM_PRIVATE_KEY` | Yes* | EVM private key for x402 payments |
| `TELEGRAPH_SOLANA_PRIVATE_KEY` | No | Solana private key (alternative) |

*Required for paid inference. Free tools (listing miners, daemon signals) work without a key.

### Payments

Paid calls use **x402** — an HTTP-native micropayment protocol. The plugin calls Telegraph's REST API directly; x402 payment challenges are handled transparently. Typical cost is $0.01–$0.05 per inference call.

**Use a burner wallet** — fund with only the USDC you need. Default network is Base Sepolia testnet.

## Architecture

```
ElizaOS Agent
  │
  │ @telegraphprotocol/plugin-elizaos
  │
  ├── TELEGRAPH_ASK → Engine /v1/ask (x402 paid)
  ├── TELEGRAPH_LIST_MINERS → Node /miner-dispatcher/integrations (free)
  └── TELEGRAPH_DAEMON_SIGNALS → Daemon /api/questions (free)
```

## Related

- [Telegraph MCP Server](https://github.com/telegraphprotocol/telegraph-mcp) — Full MCP server with 20+ tools and dynamic miner discovery
- [Telegraph Protocol Docs](https://docs.telegraphprotocol.com)
