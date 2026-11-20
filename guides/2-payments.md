# Payments

Each ask costs the price of each miner endpoint whose answer it uses, usually $0.01 in USDC. The server pays from your Telegraph escrow, on its own.

## With an Anjoman API key

If `TELEGRAPH_API_KEY` is set, none of the below applies: asks go through your Anjoman account, which pays from its own escrow balance. There is no wallet, no signing and no `fund` or `withdraw`. Deposit in Anjoman (sign in, then Deposit in the wallet menu); `telegraph_account` shows the balance and what recent jobs cost. An empty balance is refused with a message and nothing is charged. The spending limits below do not apply; the balance does, and so does the key's limit of 30 requests a minute. An auto-routed ask (`telegraph_ask_auto`) holds a budget of $0.26 while it runs and is billed only for the miners whose answers are used; a miner call (`telegraph_ask_miner`) costs that miner's price.

## Escrow (the default)

You deposit USDC into your Telegraph escrow once: run `npx -y @telegraphprotocol/telegraph-protocol-mcp fund` in a terminal and confirm. Each ask then carries a signature the server makes for you. It proves you asked, but it can't move your funds. The node checks your balance, and the epoch's asks are charged together in its ledger root. A failed ask is never billed.

## Multi-miner asks

`telegraph_ask` sends `max_budget_usdc`, the most the ask may cost in μUSDC, its first call included: `TELEGRAPH_MAX_BUDGET_USDC` (default 260000, $0.26, the most the testnet node takes; never above `TELEGRAPH_MAX_ASK_USD`). When the first miner's answer misses part of the question, the node asks the next ranked miners for the rest, each paid its own price from the budget. Escrow holds the whole budget while the ask runs, so the balance must cover it; only the calls whose answers are used are billed, and the rest is released. The reply's `fulfillment` gives `status` (`complete`, `partial`, ...), `provenance` (which miner gave each field), `payments` (one row per billed call) and `stopped` (why recovery ended). `TELEGRAPH_MAX_BUDGET_USDC=0` asks one miner only. `telegraph_ask_miner` never sends a budget: naming a miner skips recovery.

When escrow can't cover an ask, the ask is refused with the balances and how to top up. Nothing is charged, and the wallet is never paid from instead unless you turn x402 on.

## Limits and retries

The server won't pay more than `TELEGRAPH_MAX_ASK_USD` for one ask (default $0.50) or `TELEGRAPH_DAILY_LIMIT_USD` in a UTC day (default $5). An identical ask while one is running, or within a minute of one that succeeded, gets that answer back without paying again.

## x402 (only if you turn it on)

With `TELEGRAPH_PAYMENT=auto`, when escrow is empty the server pays per ask from the wallet's USDC with x402 (an EIP-3009 transfer signed by the wallet). The payment settles before the miner is called. If the ask then fails, the amount is credited to your Telegraph escrow, so it pays for later asks or can be withdrawn. The error the node returns says so in its `payment` field, when the node is new enough to send it.

## Withdrawing

Run `withdraw` and confirm the amount. It stops paying for asks at once. It is paid out against a ledger root, so
asks already served are charged first: once a root built at least 30 minutes after the request is active, or after the
fallback delay (7 days), run `withdraw` again and it is sent to your wallet.

```bash
npx -y @telegraphprotocol/telegraph-protocol-mcp withdraw 2    # request it
npx -y @telegraphprotocol/telegraph-protocol-mcp withdraw      # collect it once a root covers it
```

A new request replaces the pending one. Under the hood this is `requestWithdraw(amount)` on the Telegraph diamond,
then the calldata from the node's `GET /v1/ledger/proof/<address>` (`executeWithdraw` with the proof of your balance),
which you can also send yourself. `GET /v1/ledger/account/<address>` shows the balance and the request's status.

## Choosing a mode

`TELEGRAPH_PAYMENT=escrow` (default) pays only from escrow. `auto` tries escrow, then x402. `x402` never uses escrow.
