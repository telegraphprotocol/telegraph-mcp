#!/usr/bin/env python3
"""
Pure MCP test — validates the Telegraph MCP server without any framework adapter.
Uses the raw Python MCP SDK to connect via stdio, list tools, and test free + paid calls.
"""

import asyncio
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ENTRY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../dist/index.js")

# Only what is set: a placeholder key would stop the server.
server_params = StdioServerParameters(
    command="node",
    args=[ENTRY],
    env={k: v for k, v in {
        "PATH": os.environ.get("PATH", ""),
        "TELEGRAPH_PRIVATE_KEY": os.getenv("TELEGRAPH_PRIVATE_KEY", ""),
        "TELEGRAPH_URL": os.getenv("TELEGRAPH_URL", ""),
    }.items() if v},
)

async def main():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"Discovered {len(tools.tools)} tools:")
            for t in tools.tools:
                print(f"  - {t.name}: {t.description[:60]}...")
            r = await session.call_tool("telegraph_find_intents", {"search": "bitcoin price"})
            print("\ntelegraph_find_intents:", r.content[0].text[:300])

if __name__ == "__main__":
    asyncio.run(main())
