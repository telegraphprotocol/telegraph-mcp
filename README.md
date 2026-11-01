# Telegraph MCP server

Gives any MCP client (Claude Code, Claude Desktop, Cursor, Goose, Continue, ElizaOS, LangChain, ...) the Telegraph network: ask questions that the best-ranked miner answers, browse every intent, miner and ranking, and pay per ask in USDC from escrow or by x402. One setting, nine tools.

## Quick start

You need Node 18+ and, for paid asks, the private key of a wallet made for this (never your main wallet). Free tools work without a key.

**Claude Code**

```bash
claude mcp add telegraph -e TELEGRAPH_PRIVATE_KEY=0xyour_key -- npx -y @telegraphprotocol/telegraph-protocol-mcp
```

**Claude Desktop, Cursor and most other clients** (`claude_desktop_config.json`, `~/.cursor/mcp.json`, ...)

```json
{
  "mcpServers": {
    "telegraph": {
      "command": "npx",
      "args": ["-y", "@telegraphprotocol/telegraph-protocol-mcp"],
      "env": { "TELEGRAPH_PRIVATE_KEY": "0xyour_key" }
    }
  }
}
```

Then ask your agent things like "what is the BTC price?", "which miners serve weather and how do they rank?" or "how much is in my Telegraph escrow?". More client configs are in [examples/](examples/).

## Settings

| Variable | Default | What it is |
|---|---|---|
| `TELEGRAPH_PRIVATE_KEY` | none | Wallet that pays for asks. Without it only the free tools work. (`TELEGRAPH_EVM_PRIVATE_KEY`, the v1 name, also works.) |
| `TELEGRAPH_URL` | `http://13.237.89.59:7148` | The node (Telegraph beta 2) |
| `TELEGRAPH_PAYMENT` | `auto` | `auto`: escrow first, then x402. `escrow` or `x402`: only that one |
| `TELEGRAPH_RPC_URL` | public Sepolia RPC | Chain RPC, for the balance and deposit tools |
| `TELEGRAPH_DIAMOND`, `TELEGRAPH_CHAIN_ID` | beta 2's | The contract that holds escrow, and its chain |

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `telegraph_ask` | ~$0.01 | Ask a question (optionally an exact intent and params); the node routes it to the top live miner |
| `telegraph_ask_miner` | the miner's price | Ask one miner you choose, or call one of its endpoints directly |
| `telegraph_find_intents` | free | Search the 130+ intents (kinds of question) |
| `telegraph_intent` | free | One intent's kind, params, answer fields and top miners |
| `telegraph_find_miners` | free | An intent's miners with rank, score, price and endpoints, or a word search over all miners |
| `telegraph_ranking` | free | The latest epoch's ranking, per intent |
| `telegraph_account` | free | Wallet USDC and ETH, and the escrow balance, debt and pending withdrawal |
| `telegraph_deposit` | gas | Move wallet USDC into escrow (approve + depositUSDC) |
| `telegraph_docs` | free | Built-in guides: getting started, payments, intents and ranking, errors. Also served as MCP resources (`telegraph://docs/...`) |

## Payments

- **Escrow** (used first): deposit USDC once with `telegraph_deposit`. Each ask carries a signature that proves intent but can't move funds. Asks are deducted at the epoch close, and a failed ask is never billed.
- **x402** (fallback): when escrow is empty, the server pays each ask from the wallet's USDC. If the ask then fails, the node credits the payment to your escrow, so it stays yours.

Details, debt and withdrawing: [guides/2-payments.md](guides/2-payments.md).

## Test funds (beta 2)

Beta 2 runs on Ethereum Sepolia. Its USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`) is a test token anyone can mint with `mint(yourAddress, amount)` (6 decimals). Gas needs a little Sepolia ETH from a public faucet.

## Security

- Use a wallet made for this, holding only what you plan to spend.
- The key stays in the MCP server process; the agent never sees it.
- The server runs locally over stdio and opens no port.

## Development

```bash
npm install && npm run build
node scripts/smoke.mjs                                       # free tools against the node
TELEGRAPH_PRIVATE_KEY=0x... node scripts/smoke.mjs paid      # plus three asks (~$0.03)
node scripts/smoke.mjs call telegraph_intent '{"intent":"CRYPTO_PRICE_USD"}'
npx @modelcontextprotocol/inspector dist/index.js            # browse the tools
```

Architecture: [docs/architecture.md](docs/architecture.md). Problems: [docs/troubleshooting.md](docs/troubleshooting.md).
