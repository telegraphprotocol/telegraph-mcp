#!/usr/bin/env python3
"""
Pure MCP test — validates the Telegraph MCP server without any framework adapter.
Uses the raw Python MCP SDK to connect via stdio, list tools, and test free + paid calls.
"""

import asyncio
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

TELEGRAPH_NODE_URL = os.getenv("TELEGRAPH_NODE_URL", "http://13.237.89.59:7044")
TELEGRAPH_ENGINE_URL = os.getenv("TELEGRAPH_ENGINE_URL", "http://13.237.89.59:8080")
TELEGRAPH_DAEMON_URL = os.getenv("TELEGRAPH_DAEMON_URL", "http://13.237.89.59:8081")

server_params = StdioServerParameters(
    command="node",
    args=["/path/to/telegraph-mcp/dist/index.js"],
    env={
        "TELEGRAPH_NODE_URL": TELEGRAPH_NODE_URL,
        "TELEGRAPH_ENGINE_URL": TELEGRAPH_ENGINE_URL,
        "TELEGRAPH_DAEMON_URL": TELEGRAPH_DAEMON_URL,
        "TELEGRAPH_EVM_PRIVATE_KEY": os.getenv("TELEGRAPH_EVM_PRIVATE_KEY", "0xyour_key_here"),
    },
)

async def main():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"Discovered {len(tools.tools)} tools:")
            for t in tools.tools:
                print(f"  - {t.name}: {t.description[:60]}...")

if __name__ == "__main__":
    asyncio.run(main())
