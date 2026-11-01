---
name: telegraph
description: Use the Telegraph network through its MCP server. Activate when the user wants live facts (crypto or stock prices, FX rates, weather, gas prices, TVL), web, news or academic search, or a specialist answer (security or code review, vulnerability triage, sanctions or compliance checks, fact checks) from Telegraph's ranked miners; when they ask which Telegraph intents, miners or rankings exist; or when they ask about their Telegraph escrow balance or paying in USDC. Requires the Telegraph MCP server; paid asks need TELEGRAPH_PRIVATE_KEY.
license: MIT
homepage: https://github.com/telegraphprotocol/telegraph-mcp
metadata:
  version: 2.0.0
  homepage: https://github.com/telegraphprotocol/telegraph-mcp
  documentation: https://docs.telegraphprotocol.com
  keywords: [mcp, x402, escrow, usdc, miners, ranking, ai-agents, web3, agent-payments]
  openclaw:
    emoji: "📡"
    requires:
      config: ["mcpServers.telegraph"]
---

# Telegraph

Telegraph is a network of miners (APIs and models run by different people) that answer questions by intent. Every epoch the network checks each intent's miners and ranks them, and an ask goes to the best-ranked live miner. Asks are paid in USDC, usually $0.01.

## Tools

| Tool | Cost | Use it to |
|---|---|---|
| `telegraph_ask` | ~$0.01 | Ask a question. Optional `intent` and `params` make it exact |
| `telegraph_ask_miner` | that miner's price | Ask one miner the user chose, or call one of its endpoints directly |
| `telegraph_find_intents` | free | Find the intent for a kind of question |
| `telegraph_intent` | free | See an intent's kind, params, answer fields and top miners |
| `telegraph_find_miners` | free | List an intent's miners with rank, score and price, or search miners by words |
| `telegraph_ranking` | free | The latest ranking for an intent, or for all |
| `telegraph_account` | free | Wallet USDC and ETH, and the escrow balance |
| `telegraph_deposit` | gas | Move wallet USDC into escrow. Confirm the amount with the user first |
| `telegraph_docs` | free | How payments, intents, ranking and errors work |

## How to use it

- **A plain question is enough**: `telegraph_ask(question="What is the BTC price in USD?")`. The node finds the intent and the miner.
- **To be exact**, find the intent and its params first, then ask with them:
  `telegraph_find_intents(search="weather")` → `telegraph_intent(intent="WEATHER_CHECK_TEMPERATURE")` → `telegraph_ask(intent="WEATHER_CHECK_TEMPERATURE", params={"location": "Lahore"})`.
- The answer comes back in the intent's fields (`answer`), with the miner that answered and the payment receipt. Tell the user which miner answered.
- An intent with no ranking yet is answered by one of the miners that declare it. `telegraph_intent` says when that is the case.

## Payments

- **Escrow first**: if the wallet has a Telegraph escrow balance, each ask is signed against it and deducted at the epoch close. A failed ask is never billed.
- **x402 fallback**: otherwise the ask is paid from the wallet's USDC. If it then fails, the amount is credited to the user's escrow.
- `telegraph_account` shows the balances. `telegraph_deposit` tops up escrow, but only after the user confirms the amount.
- The private key stays in the MCP server's process. It never appears in tool inputs, outputs or model context.

## Errors

- **503 "could not route" or `no_compatible_miner`**: nothing was charged. Retry, or ask without the intent.
- **400 `invalid_params`**: check the params with `telegraph_intent`.
- **402**: escrow and wallet are both short. Check `telegraph_account`.
- **"Paying needs a wallet"**: the server has no `TELEGRAPH_PRIVATE_KEY`. The free tools still work.

## Setup

```json
{
  "mcpServers": {
    "telegraph": {
      "command": "npx",
      "args": ["-y", "@telegraphprotocol/telegraph-protocol-mcp"],
      "env": { "TELEGRAPH_PRIVATE_KEY": "0xyour_burner_wallet_key" }
    }
  }
}
```

The default network is Telegraph beta 2 on Ethereum Sepolia (test USDC). On OpenClaw this skill gates on the `mcpServers.telegraph` config entry, so it stays dormant until the server is configured. Client guides: [README](https://github.com/telegraphprotocol/telegraph-mcp#readme).
