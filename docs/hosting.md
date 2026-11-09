# Hosting the connector server

The same package runs two ways:

- **Local (stdio):** `npx -y @telegraphprotocol/telegraph-protocol-mcp`. Each user runs it on their own machine with their own wallet (`setup`).
- **Hosted (HTTP):** `npx -y @telegraphprotocol/telegraph-protocol-mcp serve --http`. One server for apps that only take a URL: Claude.ai, ChatGPT and Grok connectors.

## How the hosted server works

1. An app (Claude, ChatGPT, Grok) adds the connector URL `https://<your host>/mcp`.
2. It finds the OAuth metadata, registers itself (dynamic client registration), and sends the user to the sign-in page.
3. The user signs in with their **Anjoman account**: email and password, or a wallet signature. The server checks those with telegraph-backend (`/auth/login/email`, `/auth/wallet/message`, `/auth/wallet/verify`), the same calls anjoman.ai makes. It never stores the password.
4. The app gets its own access token. The Anjoman session stays on the server and is never sent to the app or the model.
5. `telegraph_ask` calls telegraph-backend `/agent/chat` with the user's session and `paymentMethod: "escrow"`, so it's paid from **that user's** Anjoman escrow, exactly as on anjoman.ai. `maxSpendUsd` caps each ask (default $0.50).
6. The free tools (intents, miners, ranking, docs) read the node directly.

The server holds no wallet key. Sessions are in memory, so a restart means users reconnect. Run one instance, or add a shared store before running several.

## Why paid asks go through telegraph-backend

The escrow rail needs a signature from the account that owns the escrow. A hosted server does
not have the user's key and should not: so it cannot sign `/engine/v1/ask` on their behalf, the
way the local server does with the wallet from `setup`. The only route that pays from the
signed-in person's own escrow today is telegraph-backend, which already does that signing for
anjoman.ai.

To put a hosted connector on `/engine/v1/ask` instead, the node or the backend has to offer an
endpoint that takes a signed-in session and pays that session's escrow. Until then the choice is
this route, one shared server wallet (wrong: everyone spends from one balance), or holding users'
keys on the server (a decision for the protocol team, not this package).

## Settings


| Variable | Required | What it is |
|---|---|---|
| `TELEGRAPH_MCP_PUBLIC_URL` | yes | How apps reach this server, HTTPS, e.g. `https://mcp.telegraphprotocol.com`. The OAuth issuer and the `/mcp` URL come from it. |
| `TELEGRAPH_BACKEND_URL` | yes | telegraph-backend's internal URL (what anjoman.ai calls `TELEGRAPH_BACKEND_INTERNAL_URL`) |
| `TELEGRAPH_APP_URL` | no | Default `https://anjoman.ai`, for sign-up and top-up links |
| `TELEGRAPH_MAX_ASK_USD` | no | Spending cap per ask, default `0.5` |
| `TELEGRAPH_URL` | no | The node for the free tools, default beta 2 |
| `PORT`, `HOST` | no | Default `8787`, `0.0.0.0` |

## Run it

```bash
docker build -t telegraph-mcp .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -e TELEGRAPH_MCP_PUBLIC_URL=https://mcp.telegraphprotocol.com \
  -e TELEGRAPH_BACKEND_URL=http://127.0.0.1:4100 \
  telegraph-mcp
```

Put it behind HTTPS (nginx, Caddy or Cloudflare) at the public URL. Proxy the whole host to port 8787: `/mcp`, `/authorize`, `/token`, `/register`, `/login/*`, `/health` and `/.well-known/*`. Check it:

```bash
curl https://mcp.telegraphprotocol.com/health
curl https://mcp.telegraphprotocol.com/.well-known/oauth-protected-resource/mcp
```

## Add it to each app

| App | Where | Plans (check each vendor's current docs) |
|---|---|---|
| Claude (claude.ai, Desktop) | Settings → Connectors → Add custom connector → URL `https://<host>/mcp` | Custom connectors on paid plans; one on Free per recent docs |
| ChatGPT | Settings → Apps (Connectors) → Advanced → Developer mode → Create → URL, auth OAuth | Developer mode on paid business tiers |
| Grok | grok.com/connectors → New Connector → Custom → URL | Paid tiers |

Each asks the user to sign in with Anjoman the first time. After that, "What is the BTC price? Use Telegraph" just works, paid from their escrow.

## Checked so far

`npm test` runs the whole connector flow against a stand-in for telegraph-backend that answers the same calls: metadata, registration, sign-in page, wrong password, code-to-token, a code used twice, tools, a paid ask, an empty escrow, a bad token and health. **It has not been run against the real telegraph-backend or inside Claude, ChatGPT or Grok.** That needs a public HTTPS host. Before the demo, run one real sign-in and one paid ask from each app.
