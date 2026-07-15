# ElizaOS Plugin Submission Playbook

## Prerequisites

- `telegraph-plugin-elizaos` published to npm (MIT license, scoped under `@telegraph`)
- Plugin has `elizaos` and `elizaos-plugin` in its `package.json` keywords (auto-discoverable)
- Registered in the ElizaOS plugin registry for curated listing

## Track 1 — Publish to npm (do first)

```bash
cd packages/plugin-elizaos
npm install
npm run build
npm publish --access public
```

After publish, verify:

```bash
npm info telegraph-plugin-elizaos
```

and confirm `elizaos` appears in keywords.

## Track 2 — Register on ElizaOS Plugin Registry

The ElizaOS registry now lives in `packages/registry/entries/third-party/` within the main `elizaOS/eliza` monorepo.

### Step 1: Create registry entry

Add this JSON file to `packages/registry/entries/third-party/telegraph-plugin-elizaos.json` in a fork of `elizaOS/eliza`:

```json
{
  "package": "telegraph-plugin-elizaos",
  "repository": "github:telegraphprotocol/telegraph-mcp",
  "kind": "plugin",
  "description": "Telegraph Protocol — decentralized AI inference (weather, deepfake detection, LLMs, signal feeds) with x402 USDC micropayments",
  "homepage": "https://github.com/telegraphprotocol/telegraph-mcp/tree/main/packages/plugin-elizaos",
  "version": "1.0.0",
  "directory": "packages/plugin-elizaos",
  "tags": ["ai-inference", "deepfake-detection", "weather", "llm", "x402", "mcp", "web3", "agent-payments"]
}
```

### Step 2: Validate and regenerate

```bash
git clone https://github.com/elizaOS/eliza.git
cd eliza
# Add the entry file
bun run --cwd packages/registry validate
bun run --cwd packages/registry generate
```

### Step 3: Open PR

Open a PR against `elizaOS/eliza` with:
- The new entry file in `packages/registry/entries/third-party/`
- The regenerated `generated-registry.json`

### Ready-to-paste PR body

```markdown
Title: feat(registry): add telegraph-plugin-elizaos

## What

Adds the Telegraph Protocol plugin for ElizaOS.

## Plugin

- **Package**: `telegraph-plugin-elizaos` v1.0.0
- **Repo**: https://github.com/telegraphprotocol/telegraph-mcp/tree/main/packages/plugin-elizaos
- **License**: MIT
- **Type**: plugin

## What it does

Telegraph is a decentralized AI-inference marketplace. The plugin adds:

- **TELEGRAPH_ASK** — Auto-routed inference (weather, deepfake detection, LLMs, embeddings)
- **TELEGRAPH_LIST_MINERS** — Discover available AI miners with capabilities and pricing
- **TELEGRAPH_DAEMON_SIGNALS** — Autonomous signal feeds (CRYPTO, TECHNOLOGY, CLIMATE, etc.)
- **Context providers** — Daemon signals and miner catalog injected into agent context

Payments use x402 USDC micropayments ($0.01–$0.05 per call). Free tools work without a key.

## Testing

```json
// character.json
{
  "plugins": ["telegraph-plugin-elizaos"],
  "settings": {
    "secrets": {
      "TELEGRAPH_EVM_PRIVATE_KEY": "0x..."
    }
  }
}
```
```

## Notes

- The plugin uses Telegraph's REST API directly — no MCP server needed
- Free tools (listing miners, daemon signals) work without payment setup
- Paid inference requires a burner wallet with USDC on Base Sepolia
- The `@elizaos/plugin-mcp` approach using the full Telegraph MCP server is also available for advanced users (see `examples/elizaos-telegraph/`)
