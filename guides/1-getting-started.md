# Getting started

Telegraph answers questions through a network of miners: APIs and models run by different people, each serving some intents (kinds of question). The network checks the miners every epoch and ranks them, and every ask goes to the best-ranked live miner for its intent.

## Setup

The free tools work with no setup at all. To ask questions, the user runs this once in a terminal:

```bash
npx -y @telegraphprotocol/telegraph-protocol-mcp setup
```

It creates (or imports) a wallet just for Telegraph, funds its escrow after they confirm, and adds the server to their agent app. No setting or key goes in the app's config.

Optional settings:

- `TELEGRAPH_URL`: the node to use. Default: Telegraph beta 2, `https://devnode.telegraphprotocol.com`.
- `TELEGRAPH_PAYMENT`: `escrow` (default), `auto` (escrow, then x402) or `x402`.
- `TELEGRAPH_MAX_ASK_USD`, `TELEGRAPH_DAILY_LIMIT_USD`: spending limits (default $0.50 per ask, $5 a day).
- `TELEGRAPH_RPC_URL`, `TELEGRAPH_DIAMOND`, `TELEGRAPH_CHAIN_ID`: the chain behind the node. The defaults match beta 2.

## The network today

Beta 2 runs on Ethereum Sepolia, a test network, so it costs no real money. Its USDC is Telegraph's own test token at `0xcc194e1a843B658526D0D5C431f670028582Ae17`, not Circle's: escrow takes that one and no other, and `telegraph_account` names it.

Get it from the faucet at <https://anjoman.ai/dashboard/faucet>: sign in, send it to your Telegraph wallet, 1 USDC per account every 24 hours. The `fund` command points you there. Transactions need a little Sepolia ETH for gas, which public Sepolia faucets give out.

## First steps

1. `telegraph_find_intents` with a few words, for example "weather" or "bitcoin price".
2. `telegraph_intent` on the one you want: the params it takes and the fields the answer has.
3. `telegraph_ask` with a question, or with the intent and its params.
4. `telegraph_account` shows the balances and how to top up; the user tops up with `npx -y @telegraphprotocol/telegraph-protocol-mcp fund`.

## Tools

- `telegraph_ask`: ask a question; the node picks the miner. Paid.
- `telegraph_ask_miner`: ask one miner you choose. Paid.
- `telegraph_find_intents`, `telegraph_intent`: what can be asked, and how. Free.
- `telegraph_find_miners`, `telegraph_ranking`: who answers, and how well they rank. Free.
- `telegraph_account`: balances, limits and how to top up. (`telegraph_deposit` only with `TELEGRAPH_ALLOW_AGENT_DEPOSIT`.)
- `telegraph_docs`: these guides.
