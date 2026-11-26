# Architecture

One stdio MCP server, one node URL, nine fixed tools.

## Calls

- Free tools read the node's public routes: `/engine/v1/intents`, `/engine/v1/intents/:name`, `/engine/v1/miners`, `/api/miners?intent=`, `/leaderboard/miners`, `/api/epoch`. The intent and miner lists are cached for 5 minutes.
- With an API key, asks go to the Anjoman API instead and the account pays: `telegraph_ask` to `/agent/chat`, `telegraph_ask_auto` to `/engine/ask` (the backend adds `max_budget_usdc` 260000) and `telegraph_ask_miner` to `/engine/ask/:miner`.
- `telegraph_ask` posts to `/engine/v1/ask` with `max_budget_usdc` (`TELEGRAPH_MAX_BUDGET_USDC`, capped by `TELEGRAPH_MAX_ASK_USD`); `telegraph_ask_miner` posts to `/engine/v1/ask/:miner` (canonical body, or the native `{method, endpoint, payload}` body), with no budget. `:miner` is the slug whenever one is known (an id can be refused as ambiguous); the native body takes an id only, so a slug is turned into its id there.
- `telegraph_account` reads the escrow balance from the node's `/v1/ledger/account/:address` and the wallet's USDC and ETH from the chain. `telegraph_deposit` and `fund` call `depositUSDC` on the diamond; `withdraw` calls `requestWithdraw`, then sends the node's `/v1/ledger/proof/:address` calldata (`executeWithdraw` or `executeWithdrawFallback` only).

## Paying (src/pay.ts)

1. Post without payment. A `402` carries the `Payment-Required` header with `accepts[]`: `exact` (x402) and `escrow`.
2. Escrow first (unless `TELEGRAPH_PAYMENT=x402`): substitute the wallet (lowercase), a random nonce and a 70-second window into `extra.message`, `personal_sign` it, and resend with the base64 `X-PAYMENT` envelope (`scheme: "escrow"`). An "insufficient escrow" refusal skips escrow for 5 minutes (a deposit resets that).
3. Otherwise x402 (unless `TELEGRAPH_PAYMENT=escrow`): `@x402/core` builds the EIP-3009 `exact` payment for the `exact` entries only, sent as `PAYMENT-SIGNATURE`.
4. The receipt header (`X-PAYMENT-RESPONSE` for escrow, `PAYMENT-RESPONSE` for x402) is decoded into the tool result. A budgeted ask signs for the whole budget; the spending record keeps only what was billed (`fulfillment.payments`, else the receipt) on escrow, and the whole payment on x402.

## Docs

`guides/*.md` ship in the package. Each is an MCP resource (`telegraph://docs/<name>`) and `telegraph_docs` returns one or searches their sections.
