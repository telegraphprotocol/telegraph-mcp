# Telegraph MCP server

Gives any MCP agent (Claude Desktop, Claude Code, Cursor, Codex, OpenClaw, Hermes, Goose, Continue, ElizaOS, LangChain, ...) the Telegraph network. Ask a question and the best-ranked miner answers. Payment comes from your Telegraph escrow automatically: no keys, signatures or blockchain steps for you or your agent.

## Start in three steps

You need Node 18 or later.

**1. Set up once.** In a terminal:

```bash
npx -y @telegraphprotocol/telegraph-protocol-mcp setup
```

It checks the network and creates a wallet just for Telegraph. You can import a key instead. The wallet is saved to `~/.telegraph/wallet.json`, readable only by you. Setup then shows the address and balances, moves the USDC you choose into escrow after you confirm, and offers to add Telegraph to your agent app.

**2. Restart your agent app.**

**3. Ask it something:** "What is the BTC price? Use Telegraph." Every ask after that is paid from escrow on its own.

Top up any time with `npx -y @telegraphprotocol/telegraph-protocol-mcp fund`. Check balances with `... status`.
Take USDC back out with `... withdraw`: it requests the amount, and you run it again to collect once the network has settled it.

Back up `~/.telegraph/wallet.json`. It is the only copy of the key, and the escrow balance goes with it.

## Adding it to an app by hand

No setting or key is needed: the server uses the wallet from setup. `setup` and `install <app>` write these for you where they can.

| App | How |
|---|---|
| Claude Code | `claude mcp add --scope user telegraph -- npx -y @telegraphprotocol/telegraph-protocol-mcp` |
| Claude Desktop, Cursor, OpenClaw, most others | Add to `mcpServers`: `{"telegraph": {"command": "npx", "args": ["-y", "@telegraphprotocol/telegraph-protocol-mcp"]}}` |
| Codex | In `~/.codex/config.toml`: `[mcp_servers.telegraph]`, then `command = "npx"` and `args = ["-y", "@telegraphprotocol/telegraph-protocol-mcp"]` |
| Goose, Continue, Hermes, ElizaOS, LangChain | Ready files in [examples/](examples/) |

## How paying works

- **The MCP server is your wallet.** It runs on your machine, loads the key from `~/.telegraph/wallet.json` (or `TELEGRAPH_PRIVATE_KEY`), and calls the node's `/engine/v1/ask` itself. When the node asks for payment, the server signs the escrow authorization with that key and sends the ask again. The agent never sees the key or the signature.
- **Escrow, always, by default.** You deposit USDC once. The escrow signature proves you asked, but it can't move funds. Asks are deducted at the epoch close, and **a failed ask is never billed**.
- **When escrow runs low,** the ask is refused with a message saying how much is left and how to top up. Nothing is charged, and the wallet is never paid from silently.
- **No double charges.** Repeating the same ask within a minute, or while it's still running, returns that answer, not a second charge.
- **Limits.** The server won't pay more than $0.50 for one ask or $5 a day. Change them with the settings below.
- **x402** (paying each ask straight from the wallet's USDC) is still there, but only if you turn it on: `TELEGRAPH_PAYMENT=auto` for escrow then x402, or `x402` for x402 only.

Details, debt and withdrawing: [guides/2-payments.md](guides/2-payments.md).

## Settings

All optional.

| Variable | Default | What it is |
|---|---|---|
| `TELEGRAPH_PAYMENT` | `escrow` | `escrow`; `auto` (escrow, then x402); `x402` |
| `TELEGRAPH_MAX_ASK_USD` | `0.5` | The most one ask may cost. `0` means no limit |
| `TELEGRAPH_DAILY_LIMIT_USD` | `5` | The most all asks may cost in a UTC day. `0` means no limit |
| `TELEGRAPH_HOME` | `~/.telegraph` | Where the wallet and the day's spending are kept |
| `TELEGRAPH_PRIVATE_KEY` | none | Use this key instead of the wallet file. For servers and CI. (`TELEGRAPH_EVM_PRIVATE_KEY`, the v1 name, also works.) |
| `TELEGRAPH_ALLOW_AGENT_DEPOSIT` | off | Also give the agent a `telegraph_deposit` tool |
| `TELEGRAPH_URL` | `https://devnode.telegraphprotocol.com` | The node (Telegraph beta 2) |
| `TELEGRAPH_RPC_URL`, `TELEGRAPH_DIAMOND`, `TELEGRAPH_CHAIN_ID` | beta 2's | The chain and the contract that holds escrow |

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `telegraph_ask` | ~$0.01 | Ask a question, optionally with an exact intent and params. The node routes it to the top live miner |
| `telegraph_ask_miner` | the miner's price | Ask one miner you choose, or call one of its endpoints directly |
| `telegraph_find_intents` | free | Search the 130+ intents (kinds of question) |
| `telegraph_intent` | free | One intent's kind, params, answer fields and top miners |
| `telegraph_find_miners` | free | An intent's miners with rank, score, price and endpoints, or a word search over all miners |
| `telegraph_ranking` | free | The latest epoch's ranking, per intent |
| `telegraph_account` | free | Address, network, wallet and escrow balances, limits, spending today, and how to top up |
| `telegraph_docs` | free | Built-in guides, also served as MCP resources (`telegraph://docs/...`) |
| `telegraph_deposit` | gas | Only with `TELEGRAPH_ALLOW_AGENT_DEPOSIT`: move wallet USDC into escrow |

## Test funds (beta 2)

Beta 2 runs on Ethereum Sepolia, so there's no real money. Its USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`) is Telegraph's own test token, not Circle's: the escrow takes that one and no other, and `telegraph_account` names it. Claim it at [anjoman.ai/dashboard/faucet](https://anjoman.ai/dashboard/faucet): sign in, send it to your Telegraph wallet, 1 USDC per account every 24 hours. `fund` points you there. Gas needs a little Sepolia ETH from a public faucet.

## Security

- The key lives in `~/.telegraph/wallet.json` (mode 0600), or in `TELEGRAPH_PRIVATE_KEY` if you set one. It's never in an agent's config, a tool result or a log, so the agent and its model never see it through MCP.
- Use a wallet made for this, holding only what you plan to spend. The limits cap what the agent can spend.
- By default the agent gets no tool that moves funds: deposits and withdrawals happen in your terminal, after you confirm.
- That holds for the tools. An agent that can also run shell commands (Claude Code, Codex, Cursor) can read the wallet file or run `fund` itself, so the real protection is the dedicated wallet and the limits, not the tool list.
- The server runs locally over stdio and opens no port.

## Development

```bash
npm install && npm run build && npm test
node scripts/smoke.mjs                                       # free tools against the node
node scripts/smoke.mjs paid                                  # plus three asks (~$0.03), using the setup wallet
node scripts/smoke.mjs call telegraph_intent '{"intent":"CRYPTO_PRICE_USD"}'
npx @modelcontextprotocol/inspector dist/index.js            # browse the tools
```

Architecture: [docs/architecture.md](docs/architecture.md). Problems: [docs/troubleshooting.md](docs/troubleshooting.md).
