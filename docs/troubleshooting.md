# Troubleshooting

## Server Startup

### "TELEGRAPH_EVM_PRIVATE_KEY is not set"

The server requires a private key for x402 payment signing. Set it in `.env`:

```
TELEGRAPH_EVM_PRIVATE_KEY=0xyour_private_key_here
```

Or pass it as an environment variable when starting.

### "TypeError: Cannot read properties of undefined"

The `package.json` dependencies may be out of date. Reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### "Error: connect ECONNREFUSED"

The Telegraph node at `TELEGRAPH_NODE_URL` is not reachable. Verify:
1. The node is running (check `http://<node>:7044/daemon/health`)
2. The URL is correct (should be base URL without trailing slash)
3. No firewall blocking the connection

## Tools

### Tools not appearing in MCP client

The client's MCP configuration must register the server correctly. Check your client's `mcp.json` or equivalent:

```json
{
  "mcpServers": {
    "telegraph": {
      "command": "npx",
      "args": ["telegraph-protocol-mcp"],
      "env": {
        "TELEGRAPH_NODE_URL": "http://13.237.89.59:7044",
        "TELEGRAPH_EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### "Tool not found" when calling a specific tool

Some tools require the node, engine, or daemon URLs to be configured. Check that all three env vars are set:

```bash
export TELEGRAPH_NODE_URL=http://13.237.89.59:7044
export TELEGRAPH_ENGINE_URL=http://13.237.89.59:7044
export TELEGRAPH_DAEMON_URL=http://13.237.89.59:7044
```

Note: The engine and daemon are served on the same port (7044) as sub-paths (`/engine/`, `/daemon/`).

## Payment

### "insufficient USDC balance" when calling ask_telegraph

The wallet needs Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) for x402 payments. Get testnet USDC from the [Circle faucet](https://faucet.circle.com).

### "invalid_exact_evm_signature" in node logs

The EIP-712 domain name mismatch. Base Sepolia USDC uses `"USDC"` (not `"USD Coin"`). Update to the latest MCP server version which handles this automatically.

### Payment goes through but response is empty

The request was paid but the engine couldn't route to a miner. Check:
1. The intent is supported by an active miner
2. `curl http://<node>:7044/miner-dispatcher/integrations` shows miner availability

## Node.js

### "npx: command not found"

Install Node.js 18+ and npm:

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Stale cache issues

```bash
npx clear-npx-cache
npx telegraph-protocol-mcp
```
