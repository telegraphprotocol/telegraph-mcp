# Troubleshooting

## The client shows no Telegraph tools

Check the server starts: `npx -y @telegraphprotocol/telegraph-protocol-mcp` should print `[telegraph-mcp] v2... on <url>` to stderr and wait. A wrong `TELEGRAPH_PRIVATE_KEY` (not 0x + 64 hex) or `TELEGRAPH_PAYMENT` stops it with a message.

## "Paying needs a wallet"

Set `TELEGRAPH_PRIVATE_KEY` in the client's config for this server and restart the client.

## Free tools fail with a network error

The node at `TELEGRAPH_URL` is unreachable from this machine. Try `curl $TELEGRAPH_URL/api/epoch`.

## `telegraph_account` or `telegraph_deposit` fails

They need the chain RPC (`TELEGRAPH_RPC_URL`). Public RPCs are sometimes down; set another Sepolia RPC.

## Ask errors

The tool result carries the node's `status`, `error`, `message` and a `hint`. The common ones are in [guides/4-troubleshooting.md](../guides/4-troubleshooting.md): 503 (no miner could take it, nothing charged), 400 `invalid_params`, 429, and 402 (escrow and wallet both short).
