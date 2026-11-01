# Architecture

One stdio MCP server, one node URL, nine fixed tools.

## Calls

- Free tools read the node's public routes: `/engine/v1/intents`, `/engine/v1/intents/:name`, `/engine/v1/miners`, `/api/miners?intent=`, `/leaderboard/miners`, `/api/epoch`. The intent and miner lists are cached for 5 minutes.
- `telegraph_ask` posts to `/engine/v1/ask`; `telegraph_ask_miner` posts to `/engine/v1/ask/:miner` (canonical body, or the native `{method, endpoint, payload}` body).
- `telegraph_account` and `telegraph_deposit` read and write the diamond on chain with viem (`effectiveBalance`, `escrowBalance`, `agentDebt`, `pendingWithdrawal`, `usdcToken`, `depositUSDC`).

## Paying (src/pay.ts)

1. Post without payment. A `402` carries the `Payment-Required` header with `accepts[]`: `exact` (x402) and `escrow`.
2. Escrow first (unless `TELEGRAPH_PAYMENT=x402`): substitute the wallet (lowercase), a random nonce and a 70-second window into `extra.message`, `personal_sign` it, and resend with the base64 `X-PAYMENT` envelope (`scheme: "escrow"`). An "insufficient escrow" refusal skips escrow for 5 minutes (a deposit resets that).
3. Otherwise x402 (unless `TELEGRAPH_PAYMENT=escrow`): `@x402/core` builds the EIP-3009 `exact` payment for the `exact` entries only, sent as `PAYMENT-SIGNATURE`.
4. The receipt header (`X-PAYMENT-RESPONSE` for escrow, `PAYMENT-RESPONSE` for x402) is decoded into the tool result.

## Docs

`guides/*.md` ship in the package. Each is an MCP resource (`telegraph://docs/<name>`) and `telegraph_docs` returns one or searches their sections.
