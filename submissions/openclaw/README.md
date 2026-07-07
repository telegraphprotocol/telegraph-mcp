# OpenClaw Submission Playbook

Two tracks, in order. Track 1 is permissionless and should be done immediately; Track 2 is the "default suite" goal and should be opened once Track 1 has install numbers to cite.

## Track 1 — Publish to ClawHub (do now)

ClawHub is OpenClaw's official skill registry (`clawhub.com` / [openclaw/clawhub](https://github.com/openclaw/clawhub)). Publishing requires a GitHub account **at least one week old**; releases pass automated malware scans before appearing in the public catalog.

```bash
npm i -g clawhub
clawhub login                      # GitHub OAuth

# Dry-run first — shows the exact publish plan without uploading
clawhub publish skills/telegraph \
  --slug telegraph \
  --name "Telegraph Protocol" \
  --version 1.1.0 \
  --changelog "OpenClaw gating metadata, npx-based setup, key-custody docs" \
  --dry-run

# Then publish for real (drop --dry-run)
```

After publish, verify:

```bash
clawhub install telegraph   # in a scratch workspace
```

and confirm the skill only activates when `mcpServers.telegraph` exists in `~/.openclaw/openclaw.json` (see `examples/openclaw/`).

**Version bumps**: bump `metadata.version` in `skills/telegraph/SKILL.md`, re-run `clawhub publish` with the new `--version` and a `--changelog`.

## Track 2 — Bundled-skill PR to openclaw/openclaw (when we have traction)

OpenClaw ships bundled skills with the install and filters them at load time via the `metadata.openclaw` gating block. Our skill gates on the `mcpServers.telegraph` config path, so bundling it adds **zero prompt overhead and zero attack surface** for users who haven't configured Telegraph — this is the core argument of the PR.

Steps:

1. Fork `openclaw/openclaw`, copy `skills/telegraph/` into the bundled skills directory of their repo (confirm current path at PR time — it has moved before).
2. Strip repo-specific metadata if their linter complains (keep `name`, `description`, `metadata.openclaw`).
3. Open the PR with the body below, filling in the traction numbers.

### Ready-to-paste PR body

```markdown
Title: feat(skills): add Telegraph Protocol skill (config-gated, dormant by default)

## What

Adds a bundled `telegraph` skill for the Telegraph Protocol — a decentralized
AI-inference marketplace (weather forecasting, deepfake/AI-content detection,
LLM inference, embeddings, signal feeds) paid per call via x402 USDC
micropayments through a local MCP server.

## Why it is safe to bundle

- **Dormant by default.** The skill gates on `requires.config:
  ["mcpServers.telegraph"]` — it loads only for users who have explicitly
  added the Telegraph MCP server to `openclaw.json`. Everyone else pays zero
  prompt/token overhead and the skill is invisible to the agent.
- **No new binaries or dependencies.** The MCP server runs via
  `npx -y telegraph-protocol-mcp` (MIT, published on npm, listed on the
  official MCP Registry as `io.github.telegraphprotocol/telegraph`).
- **Key custody.** The wallet private key lives only in the MCP server's
  process environment. OpenClaw and the model never see it; it never appears
  in tool inputs/outputs. Only signed x402 payment authorizations leave the
  machine. Docs mandate burner wallets; defaults point at Base Sepolia
  testnet.
- **Paid calls are explicit.** Free discovery/health/signal tools are clearly
  separated from paid inference tools in the skill text; typical paid call is
  $0.01–$0.05 USDC.

## Traction

- ClawHub: <N> installs since <date> (slug: `telegraph`)
- npm: `telegraph-protocol-mcp` — <N> weekly downloads
- MCP Registry: `io.github.telegraphprotocol/telegraph`

## Testing

Configured `mcpServers.telegraph` in `openclaw.json`, started a new session,
confirmed the skill loads and the agent calls `tg_node_list_subnets` (free)
and `tg_engine_ask` (paid, x402-settled). Removed the config entry, confirmed
the skill no longer loads.
```

## Security statement (reuse in any review thread)

> The Telegraph MCP server holds the wallet key in its own process
> environment, signs x402/EIP-3009 USDC transfer authorizations locally, and
> exposes only inference tools to the agent. The key is never part of model
> context, tool schemas, or tool results. Users are instructed to use a
> dedicated burner wallet funded with only the USDC they intend to spend.
> Defaults target Base Sepolia testnet.
