import type { IAgentRuntime, Plugin, Action, Provider, ProviderResult, Memory, State, Content, HandlerCallback, HandlerOptions, ActionResult } from "@elizaos/core";

export interface TelegraphPluginConfig {
  nodeUrl: string;
  engineUrl: string;
  daemonUrl: string;
  evmPrivateKey?: string;
  solanaPrivateKey?: string;
}

function getConfig(runtime: IAgentRuntime): TelegraphPluginConfig {
  const settings = (runtime as any).character?.settings?.secrets ?? {};
  return {
    nodeUrl: process.env.TELEGRAPH_NODE_URL || (settings as any).TELEGRAPH_NODE_URL || "http://13.237.89.59:7044",
    engineUrl: process.env.TELEGRAPH_ENGINE_URL || (settings as any).TELEGRAPH_ENGINE_URL || "http://13.237.89.59:8080",
    daemonUrl: process.env.TELEGRAPH_DAEMON_URL || (settings as any).TELEGRAPH_DAEMON_URL || "http://13.237.89.59:8081",
    evmPrivateKey: process.env.TELEGRAPH_EVM_PRIVATE_KEY || (settings as any).TELEGRAPH_EVM_PRIVATE_KEY,
    solanaPrivateKey: process.env.TELEGRAPH_SOLANA_PRIVATE_KEY || (settings as any).TELEGRAPH_SOLANA_PRIVATE_KEY,
  };
}

async function fetchTelegraph(url: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegraph API error ${res.status}: ${text}`);
  }
  return res.json();
}

const telegraphAskAction: Action = {
  name: "TELEGRAPH_ASK",
  description: "Route an AI inference query through Telegraph Protocol's decentralized network. Use for weather, deepfake detection, LLM completions, or any AI task.",
  similes: ["TELEGRAPH_INFER", "TELEGRAPH_QUERY", "TELEGRAPH"],
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    _callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult | void> => {
    const config = getConfig(runtime);
    const text = message.content?.text;
    if (!text) {
      return { text: "No query provided for Telegraph inference.", success: false };
    }
    try {
      const result = await fetchTelegraph(`${config.engineUrl}/v1/ask`, {
        method: "POST",
        body: JSON.stringify({ query: text }),
      });
      return { text: JSON.stringify(result, null, 2), success: true };
    } catch (err: any) {
      const msg = err.message || String(err);
      if (msg.includes("402") || msg.includes("payment")) {
        return { text: `Telegraph payment required — ensure a funded wallet is configured (set TELEGRAPH_EVM_PRIVATE_KEY). Details: ${msg}`, success: false, error: msg };
      }
      return { text: `Telegraph inference failed: ${msg}`, success: false, error: msg };
    }
  },
  examples: [
    [
      { name: "user", content: { text: "What's the weather forecast for Tokyo?" } },
      { name: "assistant", content: { text: "", actions: ["TELEGRAPH_ASK"] } },
    ],
    [
      { name: "user", content: { text: "Is this image AI-generated? https://example.com/photo.jpg" } },
      { name: "assistant", content: { text: "", actions: ["TELEGRAPH_ASK"] } },
    ],
  ],
};

const listMinersAction: Action = {
  name: "TELEGRAPH_LIST_MINERS",
  description: "List all available AI miners on the Telegraph Protocol network with their capabilities, endpoints, and pricing.",
  similes: ["TELEGRAPH_MINERS", "TELEGRAPH_SUBNETS", "TELEGRAPH_CATALOG"],
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    _callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult | void> => {
    const config = getConfig(runtime);
    try {
      const result = await fetchTelegraph(`${config.nodeUrl}/miner-dispatcher/integrations`);
      return { text: JSON.stringify(result, null, 2), success: true };
    } catch (err: any) {
      return { text: `Failed to fetch Telegraph miners: ${err.message}`, success: false, error: err.message };
    }
  },
  examples: [
    [
      { name: "user", content: { text: "What AI services are available on Telegraph?" } },
      { name: "assistant", content: { text: "", actions: ["TELEGRAPH_LIST_MINERS"] } },
    ],
  ],
};

const daemonQuestionsAction: Action = {
  name: "TELEGRAPH_DAEMON_SIGNALS",
  description: "Query the Telegraph Daemon for autonomous signal feeds — trending questions, market sentiment, climate data, geopolitical events, and more across categories like CRYPTO, TECHNOLOGY, POLITICS, CLIMATE.",
  similes: ["TELEGRAPH_SIGNALS", "TELEGRAPH_DAEMON", "TELEGRAPH_TRENDING"],
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    _callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult | void> => {
    const config = getConfig(runtime);
    const qs = new URLSearchParams({ limit: "10" }).toString();
    try {
      const result = await fetchTelegraph(`${config.daemonUrl}/api/questions?${qs}`);
      return { text: JSON.stringify(result, null, 2), success: true };
    } catch (err: any) {
      return { text: `Failed to fetch Telegraph daemon signals: ${err.message}`, success: false, error: err.message };
    }
  },
  examples: [
    [
      { name: "user", content: { text: "What are the trending signals on Telegraph?" } },
      { name: "assistant", content: { text: "", actions: ["TELEGRAPH_DAEMON_SIGNALS"] } },
    ],
  ],
};

const telegraphDaemonProvider: Provider = {
  name: "telegraph-daemon",
  description: "Provides Telegraph Daemon signal context — trending questions across categories",
  get: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<ProviderResult> => {
    const config = getConfig(runtime);
    try {
      const categories = await fetchTelegraph(`${config.daemonUrl}/api/categories`);
      const topCat = Array.isArray(categories) ? categories.slice(0, 5) : categories;
      return {
        data: { telegraphDaemon: topCat },
        values: { telegraphDaemonAvailable: true },
        text: `Telegraph Daemon active. Categories: ${JSON.stringify(topCat)}`,
      };
    } catch {
      return { data: {}, values: { telegraphDaemonAvailable: false }, text: "" };
    }
  },
};

const telegraphMinersProvider: Provider = {
  name: "telegraph-miners",
  description: "Provides Telegraph miner catalog context — available AI inference services",
  get: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<ProviderResult> => {
    const config = getConfig(runtime);
    try {
      const miners = await fetchTelegraph(`${config.engineUrl}/v1/subnets`);
      const names = Array.isArray(miners) ? miners.map((m: any) => m.slug || m.name || m.id).slice(0, 10) : [];
      return {
        data: { telegraphMiners: names },
        values: { telegraphMinersAvailable: names.length > 0 },
        text: names.length > 0 ? `Telegraph miners available: ${names.join(", ")}` : "",
      };
    } catch {
      return { data: {}, values: { telegraphMinersAvailable: false }, text: "" };
    }
  },
};

export const telegraphPlugin: Plugin = {
  name: "telegraph",
  description: "Telegraph Protocol plugin — decentralized AI inference with x402 USDC micropayments (weather, deepfake detection, LLMs, signal feeds)",
  actions: [
    telegraphAskAction,
    listMinersAction,
    daemonQuestionsAction,
  ],
  providers: [
    telegraphDaemonProvider,
    telegraphMinersProvider,
  ],
};

export default telegraphPlugin;
