# Payments

Each ask costs the price of the miner endpoint that answers, usually $0.01 in USDC. There are two ways to pay, and the server picks for you.

## Escrow (used first)

You deposit USDC into your Telegraph escrow once (`telegraph_deposit`). Each ask then carries a signature that proves you asked; it cannot move your funds. The node checks your balance, and the epoch's asks are deducted together when the epoch closes. A failed ask is never billed.

## x402 (the fallback)

When escrow is empty, the server pays per ask from the wallet's USDC with x402 (an EIP-3009 transfer signed by the wallet). The payment settles before the miner is called. If the ask then fails, the amount is credited to your Telegraph escrow, so it pays for later asks or can be withdrawn. The error the node returns says so in its `payment` field, when the node is new enough to send it.

## Debt

If an epoch charges more than your escrow holds, the rest becomes debt. While you have debt, the node serves no asks on any rail. Any deposit, or x402 credit, pays the debt first; only the rest becomes spendable. `telegraph_account` shows `debt_usdc`.

## Withdrawing

Call `requestWithdraw(amount)` on the Telegraph diamond (the contract that holds escrow) from your wallet. The amount stops being spendable at once. After the unlock time that `pendingWithdrawal(yourAddress)` shows, call `executeWithdraw()` to receive it. A new request replaces the pending one.

## Choosing a mode

`TELEGRAPH_PAYMENT=auto` (default) tries escrow, then x402. `escrow` never pays by x402. `x402` never uses escrow.
