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

and confirm the skill only activates when `mcp.servers.telegraph` exists in `~/.openclaw/openclaw.json` (see `examples/openclaw/`).

**Version bumps**: bump `metadata.version` in `skills/telegraph/SKILL.md`, re-run `clawhub publish` with the new `--version` and a `--changelog`.

## Track 2 — Bundled-skill PR to openclaw/openclaw (when we have traction)

OpenClaw ships bundled skills with the install and filters them at load time via the `metadata.openclaw` gating block. Our skill gates on the `mcp.servers.telegraph` config path, so bundling it adds **zero prompt overhead and zero attack surface** for users who haven't configured Telegraph — this is the core argument of the PR.

Steps:

1. Fork `openclaw/openclaw`, copy `skills/telegraph/` into the bundled skills directory of their repo (confirm current path at PR time — it has moved before).
2. Strip repo-specific metadata if their linter complains (keep `name`, `description`, `metadata.openclaw`).
3. Open the PR with the body below, filling in the traction numbers.

### Ready-to-paste PR body

```markdown
Title: feat(skills): add Telegraph Protocol skill (config-gated, dormant by default)

## What

Adds a bundled `telegraph` skill for the Telegraph network: ranked miners
(APIs and models) answer questions by intent (prices, FX, weather, search,
security, code review and 100+ others), paid per ask in USDC from a Telegraph escrow through a local MCP server.

## Why it is safe to bundle

- **Dormant by default.** The skill gates on `requires.config:
  ["mcp.servers.telegraph"]` — it loads only for users who have explicitly
  added the Telegraph MCP server to `openclaw.json`. Everyone else pays zero
  prompt/token overhead and the skill is invisible to the agent.
- **No new binaries or dependencies.** The MCP server runs via
  `npx -y @telegraphprotocol/telegraph-protocol-mcp` (MIT, published on npm, listed on the
  official MCP Registry as `io.github.telegraphprotocol/telegraph`).
- **Key custody.** The wallet private key lives only in `~/.telegraph/wallet.json`
  (mode 0600), read by the MCP server. OpenClaw and the model never see it; it
  never appears in configs or tool inputs/outputs. Only signed escrow
  authorizations, which can't move funds, leave the machine. Docs mandate burner wallets; defaults point at Telegraph beta 2
  on Ethereum Sepolia (testnet).
- **Paid calls are explicit.** Free discovery, ranking and docs tools are clearly
  separated from paid inference tools in the skill text; typical paid call is
  $0.01–$0.05 USDC.

## Traction

- ClawHub: <N> installs since <date> (slug: `telegraph`)
- npm: `@telegraphprotocol/telegraph-protocol-mcp` — <N> weekly downloads
- MCP Registry: `io.github.telegraphprotocol/telegraph`

## Testing

Configured `mcp.servers.telegraph` in `openclaw.json`, started a new session,
confirmed the skill loads and the agent calls `telegraph_find_miners` (free)
and `telegraph_ask` (paid). Removed the config entry, confirmed the skill no
longer loads. (Done with v1's tool names; repeat with v2 before submitting.)
```

## Security statement (reuse in any review thread)

> The Telegraph MCP server reads the wallet key from a file only the user can
> read, signs escrow payment authorizations locally (they can't move funds), and
> exposes only inference tools to the agent. The key is never part of model
> context, tool schemas, or tool results. Users are instructed to use a
> dedicated burner wallet funded with only the USDC they intend to spend.
> Defaults target Telegraph beta 2 on Ethereum Sepolia (testnet).
