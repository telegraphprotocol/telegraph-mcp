---
name: telegraph
description: Use Telegraph Protocol for AI inference on Bittensor subnets. Activate when asked for weather forecasts, deepfake detection, LLM inference, image generation, content moderation, signal monitoring (CRYPTO, POLITICS, PHARMA, LAW), or whenever the user wants to route AI tasks through the decentralized Telegraph network. Requires the Telegraph MCP server to be running with a funded USDC wallet.
---

# Telegraph Protocol

Telegraph routes AI inference through [Bittensor](https://bittensor.com) subnets via MCP tools. Payments are handled automatically via x402 micropayments — no blockchain interaction needed from the agent.

## Tool Quick Reference

| Task | Tool | Notes |
|------|------|-------|
| General AI / auto-routed | `tg_engine_ask` | Engine picks the best subnet |
| Weather forecast | `tg_engine_ask` | Routes to Zeus SN18 |
| Direct subnet call | `tg_engine_ask_subnet` | Requires `subnet_id` |
| Deepfake image detection | `tg_bitmind_detect_image` | Image URL or base64 |
| Deepfake video detection | `tg_bitmind_detect_video` | Video URL |
| LLM chat (OpenAI subnet) | `tg_openai_chat` | Direct OpenAI via subnet 102 |
| Image generation | `tg_openai_images_generate` | DALL-E via subnet 102 |
| Embeddings | `tg_openai_embed` | OpenAI embeddings |
| Signal monitoring | `tg_daemon_questions` | Filter by category/source/time |
| List signal categories | `tg_daemon_categories` | CRYPTO, POLITICS, PHARMA, LAW… |
| List available subnets | `tg_engine_list_subnets` | Discover what's on the network |
| Node status | `tg_node_status` | Check node health and chain info |

## How to Use

### Auto-routed inference (recommended for most tasks)
`tg_engine_ask` picks the best subnet for your query automatically:

```
tg_engine_ask(query="What is the weather forecast for Lahore tomorrow?")
tg_engine_ask(query="Explain the latest Bitcoin market movement")
tg_engine_ask(query="Is this image AI-generated?", image_url="https://...")
```

### Direct subnet routing
Use `tg_engine_ask_subnet` when you need a specific subnet:
- `subnet_id: "18"` — Zeus (weather forecasting)
- `subnet_id: "34"` — BitMind (deepfake detection)
- `subnet_id: "102"` — OpenAI (LLM, images, embeddings)

### Signal monitoring
```
tg_daemon_categories()
# → CRYPTO, POLITICS, PHARMA, LAW, TECHNOLOGY, ...

tg_daemon_questions(category="CRYPTO", limit=10)
tg_daemon_questions(category="POLITICS", source="twitter", limit=5)
```

### Deepfake detection
```
tg_bitmind_detect_image(image_url="https://example.com/photo.jpg")
# Returns: { is_ai_generated: true/false, confidence: 0.97 }
```

## Payments

All inference calls cost ~$0.01 USDC, charged automatically via x402. The agent never sees the payment flow — tools return results transparently.

- Use a **burner wallet** funded with only the USDC needed
- Payment is per-call; failed calls are not charged
- Check wallet balance before bulk operations

## Setup (first time)

1. Clone and build the MCP server:
   ```bash
   git clone https://github.com/0xWick/Telegraph-MCP
   cd Telegraph-MCP
   npm install && npm run build
   ```

2. Configure your MCP client (Claude Desktop, Cursor, etc.):
   ```json
   {
     "mcpServers": {
       "telegraph": {
         "command": "node",
         "args": ["/path/to/Telegraph-MCP/dist/index.js"],
         "env": {
           "TELEGRAPH_NODE_URL": "http://13.237.89.59:7044",
           "TELEGRAPH_ENGINE_URL": "http://13.237.89.59:8080",
           "TELEGRAPH_DAEMON_URL": "http://13.237.89.59:8081",
           "TELEGRAPH_EVM_PRIVATE_KEY": "0xyour_burner_wallet_key"
         }
       }
     }
   }
   ```

Full integration guides for Claude Desktop, Cursor, ElizaOS, LangChain, Goose, and more are in the [README](https://github.com/0xWick/Telegraph-MCP).

## Dynamic Tool Discovery

Subnet tools auto-update every 5 minutes from the live Telegraph node. New subnets on the network appear automatically — no MCP restart required.
