# LangChain + Telegraph MCP Example

Connects a LangChain agent to the **Telegraph MCP server** to access decentralized AI inference with automatic x402 micropayments.

Uses [`langchain-mcp-adapters`](https://github.com/langchain-ai/langchain-mcp-adapters) — the official LangChain library for MCP integration.

## Quick Start

```bash
cd examples/langchain

# 1. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure
cp .env.example .env
# Edit: set TELEGRAPH_EVM_PRIVATE_KEY (must be funded with USDC)

# 4. Run the agent test
python agent.py
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAPH_EVM_PRIVATE_KEY` | Yes | EVM private key for x402 payments |
| `OPENAI_API_KEY` | No | OpenAI key (optional, for agent LLM) |

## What the test script does

1. Connects to Telegraph MCP server via stdio
2. Lists all available Telegraph tools
3. Tests free tools: `tg_daemon_health`, `tg_engine_list_subnets`, `tg_daemon_categories`
4. Tests x402-paid tools: `tg_engine_ask` (requires funded private key)

## Using with a LangChain Agent

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain.agents import create_agent

client = MultiServerMCPClient({
    "telegraph": {
        "transport": "stdio",
        "command": "node",
        "args": ["/path/to/telegraph-mcp/dist/index.js"],
        "env": {
            "TELEGRAPH_NODE_URL": "http://13.237.89.59:7044",
            "TELEGRAPH_ENGINE_URL": "http://13.237.89.59:8080",
            "TELEGRAPH_DAEMON_URL": "http://13.237.89.59:8081",
            "TELEGRAPH_EVM_PRIVATE_KEY": "0xyour_key",
        },
    }
})

tools = await client.get_tools()
agent = create_agent("claude-sonnet-4-6", tools)

response = await agent.ainvoke({
    "messages": [{"role": "user", "content": "What's the weather in Lahore?"}]
})
```
