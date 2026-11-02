# Getting started

Telegraph answers questions through a network of miners: APIs and models run by different people, each serving some intents (kinds of question). The network checks the miners every epoch and ranks them, and every ask goes to the best-ranked live miner for its intent.

## One setting

The server works with no settings for the free tools. To ask questions it needs a wallet:

- `TELEGRAPH_PRIVATE_KEY`: the 0x private key of a wallet for paying. Use a wallet made for this, not your main one.

Optional:

- `TELEGRAPH_URL`: the node to use. Default: Telegraph beta 2, `https://devnode.telegraphprotocol.com`.
- `TELEGRAPH_PAYMENT`: `auto` (default: escrow first, then x402), `escrow` or `x402`.
- `TELEGRAPH_RPC_URL`, `TELEGRAPH_DIAMOND`, `TELEGRAPH_CHAIN_ID`: the chain behind the node. The defaults match beta 2.

## The network today

Beta 2 runs on Ethereum Sepolia, a test network, so it costs no real money. Its USDC is a test token at `0xcc194e1a843B658526D0D5C431f670028582Ae17` that anyone can mint: call `mint(yourAddress, amount)` on it (6 decimals, so `10000000` is 10 USDC). Transactions need a little Sepolia ETH for gas, which public Sepolia faucets give out.

## First steps

1. `telegraph_find_intents` with a few words, for example "weather" or "bitcoin price".
2. `telegraph_intent` on the one you want: the params it takes and the fields the answer has.
3. `telegraph_ask` with a question, or with the intent and its params.
4. `telegraph_account` shows what you have; `telegraph_deposit` moves USDC into escrow.

## Tools

- `telegraph_ask`: ask a question; the node picks the miner. Paid.
- `telegraph_ask_miner`: ask one miner you choose. Paid.
- `telegraph_find_intents`, `telegraph_intent`: what can be asked, and how. Free.
- `telegraph_find_miners`, `telegraph_ranking`: who answers, and how well they rank. Free.
- `telegraph_account`, `telegraph_deposit`: balances and topping up escrow.
- `telegraph_docs`: these guides.
