"""
LangChain agent connected to Telegraph MCP server.

Uses langchain-mcp-adapters to connect to the Telegraph MCP server via stdio
and access decentralized AI inference tools.
"""

import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient

load_dotenv()

# Path to Telegraph MCP binary
TELEGRAPH_MCP_DIR = os.path.join(os.path.dirname(__file__), "../../")
TELEGRAPH_MCP_ENTRY = os.path.join(TELEGRAPH_MCP_DIR, "dist/index.js")

SYSTEM_PROMPT = """\
You are the Telegraph Agent, an AI assistant connected to the Telegraph network,
where ranked miners (APIs and models) answer questions by intent.

RULES FOR USING TELEGRAPH TOOLS:
1. ASK: For live facts (prices, FX, weather, search) and specialist answers
   (security, code review, compliance), use telegraph_ask with the question.
2. DISCOVERY: telegraph_find_intents shows what can be asked, telegraph_intent an
   intent's params, telegraph_find_miners and telegraph_ranking who answers.
3. ONE MINER: telegraph_ask_miner asks a miner the user names.
4. MONEY: An ask costs about $0.01. telegraph_account shows balances and how to top up.

Always say which miner answered.
"""


async def main():
    print("=" * 60)
    print("Telegraph MCP + LangChain Agent")
    print("=" * 60)

    # ── Connect to Telegraph MCP ────────────────────────────────────────
    print("\nConnecting to Telegraph MCP server...")

    client = MultiServerMCPClient({
        "telegraph": {
            "transport": "stdio",
            "command": "node",
            "args": [TELEGRAPH_MCP_ENTRY],
            "env": {k: v for k, v in {
                "PATH": os.environ.get("PATH", ""),
                "TELEGRAPH_PRIVATE_KEY": os.getenv("TELEGRAPH_PRIVATE_KEY", ""),
                "TELEGRAPH_URL": os.getenv("TELEGRAPH_URL", ""),
            }.items() if v},
        }
    })

    try:
        tools = await client.get_tools()
        print(f"✅ Connected! {len(tools)} Telegraph tools loaded:")
        for t in tools:
            print(f"   • {t.name}: {t.description[:80]}...")
    except Exception as e:
        print(f"❌ Failed to connect: {e}")
        print(f"   Entry point: {TELEGRAPH_MCP_ENTRY}")
        print(f"   Exists: {os.path.exists(TELEGRAPH_MCP_ENTRY)}")
        return

    # ── Test tools ──────────────────────────────────────────────────────
    print("\n" + "-" * 60)
    print("Testing Telegraph tools...")
    print("-" * 60)

    # Test 1: Free tools (no payment)
    tests_free = [
        ("telegraph_find_intents", {"search": "weather"}, "Find intents"),
        ("telegraph_ranking", {"intent": "CRYPTO_PRICE_USD", "limit": 3}, "Ranking"),
        ("telegraph_docs", {}, "Docs"),
    ]

    for tool_name, args, label in tests_free:
        print(f"\n🔍 {label} ({tool_name})...")
        try:
            # Find the tool
            tool = next((t for t in tools if t.name == tool_name), None)
            if not tool:
                print(f"   ⚠️ Tool not found")
                continue
            # Invoke through langchain tool
            result = await tool.ainvoke(args)
            text = str(result)
            print(f"   ✅ Result: {text[:300]}...")
        except Exception as e:
            print(f"   ❌ Error: {e}")

    # Test 2: a paid ask (needs the wallet from setup)
    print("\n🔍 Routed ask (telegraph_ask)...")
    tool = next((t for t in tools if t.name == "telegraph_ask"), None)
    if tool:
        print("   Asking: 'What is the BTC price in USD?'")
        try:
            result = await tool.ainvoke({"question": "What is the BTC price in USD?"})
            text = str(result)
            print(f"   ✅ Result: {text[:400]}...")
        except Exception as e:
            print(f"   ❌ Error (needs the wallet from setup): {e}")

    print("\n" + "=" * 60)
    print("All tests complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
