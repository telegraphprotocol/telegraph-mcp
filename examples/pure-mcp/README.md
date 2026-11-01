# Pure MCP + Telegraph

Validates the Telegraph MCP server using the raw Python MCP SDK — no framework adapter.

## Setup

```bash
pip install -r requirements.txt
export TELEGRAPH_PRIVATE_KEY=0xyour_key_here   # optional: only paid asks need it
python test_mcp.py
```

## What it does

- Connects to the Telegraph MCP server via stdio
- Lists all discovered tools
- Calls one free tool (`telegraph_find_intents`)

This is the canonical validation script: if this passes, any stdio MCP client will work.
