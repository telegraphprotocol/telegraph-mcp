---
name: telegraph
description: Use Telegraph Protocol for verified AI inference. Activate when the user asks for: weather forecasts or climate data; deepfake or AI-content detection; LLM completions, image generation, or embeddings via a decentralized network; AI text detection; autonomous signal monitoring across categories like PHARMA, TECHNOLOGY, CLIMATE, HEALTH, ECONOMICS, or GEOPOLITICS; or any task where the user explicitly wants to route inference through the Telegraph network or pay via x402 USDC micropayments. Requires the Telegraph MCP server running with a USDC-funded EVM or Solana wallet.
---

# Telegraph Protocol

Telegraph is a permissionless marketplace for verifiable AI inference. Agents pay USDC per request. Miners — which can be Bittensor subnets, OpenAI, open-source models, or any AI API — compete to supply answers. A decentralized validator mesh grades responses using zkTLS-verified ground truth and WASM scoring scripts, reaches BFT consensus, and delivers a cryptographically finalized result.

The native token is **MACHINA**. Every USDC paid for inference flows through an open-market TWAP to buy MACHINA for the miner — demand for intelligence directly drives demand for the token.

---

## MCP Tool Reference

### Free tools (no payment)

| Tool | Purpose |
|------|---------|
| `tg_node_list_subnets` | Full subnet catalog — IDs, slugs, endpoints, input/output schemas |
| `tg_node_subnets_health` | Health status of all subnet integrations |
| `tg_node_status` | Node identity, public key, chain info |
| `tg_engine_list_subnets` | Engine's view of available subnets with capabilities and cost |
| `tg_daemon_categories` | Signal categories in the Daemon database (PHARMA, CLIMATE, TECHNOLOGY, …) |
| `tg_daemon_questions` | Query cached Daemon signals — filterable by category, source, time, interest |
| `tg_daemon_health` | Daemon health check |

### Paid tools (x402 USDC per call)

| Tool | Purpose |
|------|---------|
| `tg_engine_ask` | Auto-routed inference — Engine's LLM router selects the best miner for your query |
| `tg_engine_ask_subnet` | Direct inference to a specific subnet by ID |
| Dynamic tools (auto-discovered) | Per-subnet tools generated from the live integration registry (see below) |

---

## Access Modes

### 1. Auto-routed inference (recommended)
The Engine classifies your natural language query into an Intent and routes to the highest-ranked miner for that task:

```
tg_engine_ask(query="7-day weather forecast for Dubai")
tg_engine_ask(query="Is this image AI-generated?")
tg_engine_ask(query="Summarize the latest clinical trial results for GLP-1 drugs")
```

The response includes `routing.reasoning` — which subnet was chosen and why.

### 2. Direct subnet inference
Route to a specific subnet when you know exactly what you want:

```
tg_engine_ask_subnet(subnet_id="18", method="GET", endpoint="/predict", payload={lat: 25.2, lon: 55.3, variable: "hourly"})
tg_engine_ask_subnet(subnet_id="34", method="POST", endpoint="/", payload={image_url: "https://..."})
tg_engine_ask_subnet(subnet_id="102", method="POST", endpoint="/chat", payload={model: "gpt-4o-mini", messages: [...]})
```

### 3. Daemon signal feed (free reads)
The Daemon runs autonomously every 3 hours — collecting data from registered sources (weather APIs, clinical trials, news feeds), routing questions through miners, and caching verified results. Reading these is free:

```
tg_daemon_categories()
# → PHARMA (72), TECHNOLOGY (15), CLIMATE (5), HEALTH (4), ECONOMICS (4), GEOPOLITICS (2), SCIENCE (1)

tg_daemon_questions(category="PHARMA", limit=10)
tg_daemon_questions(category="CLIMATE", sort="interest", min_interest=5)
tg_daemon_questions(source="clinicaltrials", since_hours=24)
```

### 4. Dynamic subnet tools (auto-discovered)
On startup, the MCP server fetches the live integration registry and generates per-endpoint tools for every active miner. These update every 5 minutes without restart. Current examples:

| Tool (auto-generated) | Miner | Capability |
|-----------------------|-------|-----------|
| `tg_zeus_predict` | SN18 Zeus | Weather forecast |
| `tg_bitmind_detect_image` | SN34 BitMind | Deepfake image detection |
| `tg_bitmind_detect_video` | SN34 BitMind | Deepfake video detection |
| `tg_openai_chat` | OpenAI (SN102) | GPT-4o-mini chat |
| `tg_openai_images_generate` | OpenAI (SN102) | Image generation |
| `tg_openai_embed` | OpenAI (SN102) | Text embeddings |
| `tg_openai_moderate` | OpenAI (SN102) | Content moderation |
| `tg_apex_generate` | SN1 Apex | Bittensor text generation |
| `tg_itsai_text_detector_detect` | SN32 ItsAI | AI text detection |
| `tg_sapling_ai_detector_detect` | SN33 Sapling | AI content detection |

Use `tg_node_list_subnets` to see the current live catalog with full schemas.

---

## Active Intents

The Engine's LLM router maps queries to canonical Intents:

| Category | Intents |
|----------|---------|
| Language | `LANGUAGE_GENERATION`, `CHAT_COMPLETION`, `TEXT_GENERATION`, `HIGH_PERFORMANCE_INFERENCE`, `EMBEDDINGS`, `CONTENT_MODERATION` |
| Weather | `WEATHER_CHECK`, `WEATHER_FORECAST`, `STORM_ALERT`, `WEATHER_RISK_ASSESSMENT` |
| Vision | `MULTIMODAL_INFERENCE`, `IMAGE_GENERATION`, `TEXT_TO_IMAGE` |
| Search | `WEB_SEARCH`, `TWITTER_SEARCH`, `NEWS_SEARCH`, `RESEARCH_SYNTHESIS`, `FACT_CHECK` |
| Authenticity | `DEEPFAKE_DETECTION`, `MEDIA_AUTHENTICITY_CHECK`, `AI_TEXT_DETECTION`, `TEXT_AUTHENTICITY_CHECK`, `IMAGE_VERIFICATION`, `VIDEO_VERIFICATION` |
| Tasks | `TASK_COMPLETION`, `AGENT_TASK` |

---

## Payments

All paid calls use **x402** — an HTTP-native micropayment protocol. The MCP server handles the full flow transparently: receives the 402 challenge, signs the USDC transfer using your configured private key, and retries. The agent never sees the payment step.

- **Network**: Base Sepolia (testnet) — USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **Typical cost**: $0.01 – $0.05 per inference call
- **Pricing**: miner's floor price × demand multiplier (1× at current testnet volumes)
- **Use a burner wallet** — fund with only the USDC you need; never use a main wallet

---

## Setup

1. Clone and build:
   ```bash
   git clone https://github.com/0xWick/Telegraph-MCP
   cd Telegraph-MCP && npm install && npm run build
   ```

2. Add to your MCP client config (Claude Desktop, Cursor, etc.):
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

Full integration guides for Claude Desktop, Cursor, ElizaOS, LangChain, Goose, and others are in the [README](https://github.com/0xWick/Telegraph-MCP#readme).
