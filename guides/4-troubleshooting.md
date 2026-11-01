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

## 402 insufficient escrow

The escrow can't cover the ask. In `auto` mode the server then pays by x402; in `escrow` mode, top up with `telegraph_deposit`.

## 402 after paying by x402

The wallet may lack USDC, or the payment was refused. `telegraph_account` shows the wallet balance.

## 500 or 502 after payment

The miner failed. On escrow nothing is billed. An x402 payment is credited to your escrow, so it stays yours.

## Paying needs a wallet

Set `TELEGRAPH_PRIVATE_KEY` in the MCP server's settings and restart the client.
