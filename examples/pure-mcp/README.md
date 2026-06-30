# Pure MCP + Telegraph

Validates the Telegraph MCP server using the raw Python MCP SDK — no framework adapter.

## Setup

```bash
pip install -r requirements.txt
export TELEGRAPH_EVM_PRIVATE_KEY=0xyour_key_here
python test_mcp.py
```

## What it does

- Connects to the Telegraph MCP server via stdio
- Lists all discovered tools
- Verifies free tools (health, subnets, categories)
- Verifies paid tools (x402 engine ask)

This is the canonical validation script: if this passes, any stdio MCP client will work.
