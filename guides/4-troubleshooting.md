# Errors and fixes

## 503 could not route this question now

No miner could take the question at that moment. Nothing was charged. Retry, or ask with a specific intent.

## 503 no_compatible_miner

You named an intent that no live miner serves now. Nothing was charged. Ask without the intent, or pick another with `telegraph_find_intents`.

## 400 invalid_params

The params don't fit the intent's schema: missing, wrong type, or not allowed. `telegraph_intent` lists the params and types.

## 400 no_input_schema

That intent takes no params. Send a question only.

## 429 too many requests

Too many new questions in one minute. Wait a minute.

## 402 escrow balance too low

The escrow can't cover the ask. Nothing was charged. The user runs `npx -y @telegraphprotocol/telegraph-protocol-mcp fund` in a terminal, then asks again. (Only with `TELEGRAPH_PAYMENT=auto` would the server pay from the wallet by x402 instead.)

## Over a spending limit

The ask would cost more than `TELEGRAPH_MAX_ASK_USD`, or today's asks would pass `TELEGRAPH_DAILY_LIMIT_USD`. Nothing was signed or paid. Raise the limit in the server's settings, or wait for the next UTC day.

## 402 after paying by x402 (x402 turned on)

The wallet may lack USDC, or the payment was refused. `telegraph_account` shows the wallet balance.

## 500 or 502 after payment

The miner failed. On escrow nothing is billed. An x402 payment is credited to your escrow, so it stays yours.

## Paying needs a wallet

The server found no wallet. The user runs `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`, then restarts the agent app.
