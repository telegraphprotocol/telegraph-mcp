# Pure MCP + Telegraph

Validates the Telegraph MCP server using the raw Python MCP SDK — no framework adapter.

## Setup

```bash
pip install -r requirements.txt
# paid asks use the wallet from `npx -y @telegraphprotocol/telegraph-protocol-mcp setup`
python test_mcp.py
```

## What it does

- Connects to the Telegraph MCP server via stdio
- Lists all discovered tools
- Calls one free tool (`telegraph_find_intents`)

This is the canonical validation script: if this passes, any stdio MCP client will work.
