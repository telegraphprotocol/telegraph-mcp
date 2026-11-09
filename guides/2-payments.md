# Payments

Each ask costs the price of the miner endpoint that answers, usually $0.01 in USDC. The server pays from your Telegraph escrow, on its own.

## Escrow (the default)

You deposit USDC into your Telegraph escrow once: run `npx -y @telegraphprotocol/telegraph-protocol-mcp fund` in a terminal and confirm. Each ask then carries a signature the server makes for you. It proves you asked, but it can't move your funds. The node checks your balance, and the epoch's asks are deducted together when the epoch closes. A failed ask is never billed.

When escrow can't cover an ask, the ask is refused with the balances and how to top up. Nothing is charged, and the wallet is never paid from instead unless you turn x402 on.

## Limits and retries

The server won't pay more than `TELEGRAPH_MAX_ASK_USD` for one ask (default $0.50) or `TELEGRAPH_DAILY_LIMIT_USD` in a UTC day (default $5). An identical ask while one is running, or within a minute of one that succeeded, gets that answer back without paying again.

## x402 (only if you turn it on)

With `TELEGRAPH_PAYMENT=auto`, when escrow is empty the server pays per ask from the wallet's USDC with x402 (an EIP-3009 transfer signed by the wallet). The payment settles before the miner is called. If the ask then fails, the amount is credited to your Telegraph escrow, so it pays for later asks or can be withdrawn. The error the node returns says so in its `payment` field, when the node is new enough to send it.

## Debt

If an epoch charges more than your escrow holds, the rest becomes debt. While you have debt, the node serves no asks on any rail. Any deposit, or x402 credit, pays the debt first; only the rest becomes spendable. `telegraph_account` shows `debt_usdc`.

## Withdrawing

Call `requestWithdraw(amount)` on the Telegraph diamond (the contract that holds escrow) from your wallet. The amount stops being spendable at once. After the unlock time that `pendingWithdrawal(yourAddress)` shows, call `executeWithdraw()` to receive it. A new request replaces the pending one.

## Choosing a mode

`TELEGRAPH_PAYMENT=escrow` (default) pays only from escrow. `auto` tries escrow, then x402. `x402` never uses escrow.
