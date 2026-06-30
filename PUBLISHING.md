# Publishing & Registration

How to publish `telegraph-protocol-mcp` to npm and register it on the public **MCP Registry** and **skills.sh** directories.

The repo already ships the required manifests:

- [`package.json`](./package.json) — `name: telegraph-protocol-mcp`, `mcpName: io.github.telegraphprotocol/telegraph`
- [`server.json`](./server.json) — MCP Registry server manifest
- [`skills.sh.json`](./skills.sh.json) — skills.sh repo-page grouping
- [`.agents/skills/telegraph/SKILL.md`](./.agents/skills/telegraph/SKILL.md) — the skill descriptor

---

## 1. Publish the npm package

The MCP Registry only stores metadata — the package itself must live on npm first.

```bash
npm install
npm run build          # compiles to dist/ (verified to pass)
npm login              # authenticate (npm whoami to confirm)
npm publish --access public
```

Verify: https://www.npmjs.com/package/telegraph-protocol-mcp

> `package.json` contains `"mcpName": "io.github.telegraphprotocol/telegraph"`. The MCP Registry reads this field from the published package to verify ownership, so it **must** be present in what you publish (it is committed here). Keep `version` in `package.json` and `server.json` in sync on every release.

## 2. Register on the MCP Registry

Install the publisher CLI:

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
# or: brew install mcp-publisher
```

Authenticate and publish. Because the server name is `io.github.telegraphprotocol/...`, you must authenticate as a member of the **telegraphprotocol** GitHub org:

```bash
mcp-publisher login github
mcp-publisher publish        # reads ./server.json
```

Verify:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.telegraphprotocol/telegraph"
```

> If you see `"You do not have permission to publish this server"`, your GitHub auth namespace doesn't match the `io.github.telegraphprotocol/` prefix — authenticate with an account that belongs to the org, or change the name in `server.json` + the `mcpName` in `package.json` to your own namespace (`io.github.<your-username>/telegraph`).

## 3. Register / customize on skills.sh

skills.sh discovers the skill automatically from `.agents/skills/telegraph/SKILL.md` once the repo is seen by its telemetry — which happens the first time anyone installs from the repo with the skills CLI:

```bash
npx skills add telegraphprotocol/telegraph-mcp/telegraph
```

[`skills.sh.json`](./skills.sh.json) controls how the repo page at `https://skills.sh/telegraphprotocol/telegraph-mcp` groups the skill. Repo pages are cached, so changes appear after the cache refreshes following a recent install.

---

## Release checklist

1. Bump `version` in **both** `package.json` and `server.json`.
2. `npm run build` and smoke-test (`npm run inspect`).
3. `npm publish --access public`.
4. `mcp-publisher publish`.
5. Tag the release: `git tag v<version> && git push --tags`.
