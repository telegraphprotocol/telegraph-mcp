import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { Payer, type PaidResponse } from "./pay.js";
import { Chain } from "./chain.js";
import { cached, getJson } from "./http.js";
import { loadGuides, searchGuides } from "./docs.js";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (v: unknown): Text => ({
  content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
});
const fail = (msg: string): Text => ({ content: [{ type: "text", text: msg }], isError: true });

// Turns a thrown error into a tool error the model can read.
const guard =
  <A>(fn: (a: A) => Promise<Text>) =>
  async (a: A): Promise<Text> => {
    try {
      return await fn(a);
    } catch (e: any) {
      return fail(e?.message || String(e));
    }
  };

const NO_KEY =
  "Paying needs a wallet: set TELEGRAPH_PRIVATE_KEY (the 0x private key of a wallet holding USDC on the " +
  "Telegraph network) in this MCP server's settings and restart it. The free tools (find intents, miners, " +
  "ranking, docs) work without one.";

const trim = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const name = (s: string) => s.trim().toUpperCase();

export function registerTools(server: McpServer, cfg: Config): Payer | undefined {
  const payer = cfg.privateKey ? new Payer(cfg, cfg.privateKey) : undefined;
  const chain = new Chain(cfg);
  const intents = cached(() => getJson(`${cfg.url}/engine/v1/intents`).then((d) => d.intents as any[]));
  const miners = cached(() => getJson(`${cfg.url}/engine/v1/miners`, 60_000).then((d) => d.miners as any[]));
  const guides = loadGuides();

  const askShape = {
    question: z.string().optional().describe("The question, in plain words."),
    intent: z
      .string()
      .optional()
      .describe("Optional exact intent, e.g. CRYPTO_PRICE_USD (see telegraph_find_intents). Only that intent's miners answer."),
    params: z
      .record(z.any())
      .optional()
      .describe('Optional params for the intent, as telegraph_intent lists them, e.g. {"location": "Lahore"}. Needs intent.'),
  };
  const askBody = (a: { question?: string; intent?: string; params?: Record<string, unknown> }) => {
    if (a.params && !a.intent) throw new Error("params need an intent.");
    if (!a.question && !a.params) throw new Error("Give a question, or an intent with params.");
    return {
      ...(a.question ? { query: a.question } : {}),
      ...(a.intent ? { intent: name(a.intent) } : {}),
      ...(a.params ? { params: a.params } : {}),
    };
  };
  const paid = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const free = { readOnlyHint: true, openWorldHint: true };

  server.registerTool(
    "telegraph_ask",
    {
      title: "Ask Telegraph",
      description:
        "Ask the Telegraph network a question: live prices, FX, weather, web and academic search, security, code " +
        "review, compliance and 100+ other intents. The node routes it to the best-ranked live miner and returns " +
        "its answer in the intent's fields. Costs about $0.01, paid from the Telegraph escrow balance (a failed ask " +
        "is never billed) or by x402 from the wallet's USDC.",
      inputSchema: askShape,
      annotations: paid,
    },
    guard(async (a) => (payer ? answer(await payer.post("/engine/v1/ask", askBody(a))) : fail(NO_KEY))),
  );

  server.registerTool(
    "telegraph_ask_miner",
    {
      title: "Ask one miner",
      description:
        "Ask one specific miner (by id or slug from telegraph_find_miners) instead of letting the node pick. Send " +
        "a question (with intent when the miner serves several), or call one of its endpoints directly with " +
        "endpoint, method and payload (the raw answer comes back). No fallback miner is tried. Paid like " +
        "telegraph_ask, at that miner's price.",
      inputSchema: {
        miner: z.string().describe("Miner id or slug."),
        ...askShape,
        endpoint: z.string().optional().describe("Direct call: the miner's endpoint path, e.g. /query (telegraph_find_miners lists them)."),
        method: z.enum(["GET", "POST"]).optional().describe("Direct call: HTTP method (default GET)."),
        payload: z.record(z.any()).optional().describe("Direct call: the body or query fields the endpoint takes."),
      },
      annotations: paid,
    },
    guard(async (a) => {
      if (!payer) return fail(NO_KEY);
      const body = a.endpoint ? { method: a.method || "GET", endpoint: a.endpoint, payload: a.payload || {} } : askBody(a);
      // The node's direct-call form finds a miner by id only, so a slug is looked up first.
      const id = (await miners().catch(() => [] as any[])).find((m) => m.slug === a.miner)?.id ?? a.miner;
      return answer(await payer.post(`/engine/v1/ask/${encodeURIComponent(id)}`, body), true);
    }),
  );

  server.registerTool(
    "telegraph_find_intents",
    {
      title: "Find intents",
      description:
        "Search the intents (kinds of question) the network answers, with how many miners serve each. Free. " +
        "Without search, lists every intent name.",
      inputSchema: {
        search: z.string().optional().describe("Words to look for, e.g. 'weather', 'bitcoin price', 'code review'."),
        limit: z.number().int().min(1).max(200).optional().describe("Most results to return (default 10)."),
      },
      annotations: free,
    },
    guard(async ({ search, limit }) => {
      const all = await intents();
      if (!search) return ok({ count: all.length, intents: all.map((i) => `${i.intent_name} (${i.miner_count} miners)`) });
      const words = search.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const found = all
        .map((i) => {
          // A word scores 3 when it starts a part of the name, 1 when it starts a word of the description.
          const parts = String(i.intent_name).toLowerCase().split("_");
          const d = ` ${String(i.description || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")}`;
          const score = words.reduce(
            (s, w) => s + (parts.some((p) => p.startsWith(w)) ? 3 : 0) + (d.includes(` ${w}`) ? 1 : 0),
            0,
          );
          return { i, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.i.miner_count - a.i.miner_count)
        .slice(0, limit ?? 10)
        .map(({ i }) => ({ intent: i.intent_name, miners: i.miner_count, description: trim(i.description, 240) }));
      return ok(found.length ? found : `No intent matches "${search}". Try other words, or call without search.`);
    }),
  );

  server.registerTool(
    "telegraph_intent",
    {
      title: "Intent details",
      description:
        "One intent: its kind (deterministic, hybrid or judgment), the params an ask can send, the fields the answer " +
        "comes back in, and its top-ranked miners. Free.",
      inputSchema: { intent: z.string().describe("Intent name, e.g. WEATHER_CHECK_TEMPERATURE.") },
      annotations: free,
    },
    guard(async ({ intent }) => {
      const id = name(intent);
      const [d, board, list] = await Promise.all([
        getJson(`${cfg.url}/engine/v1/intents/${encodeURIComponent(id)}`),
        getJson(`${cfg.url}/leaderboard/miners?intent=${encodeURIComponent(id)}&limit=5`).catch(() => undefined),
        intents().catch(() => [] as any[]),
      ]);
      const top = rankingRows(board, id);
      return ok({
        intent: d.intent_name,
        kind: d.class,
        description: list.find((i) => i.intent_name === id)?.description,
        miners: d.miner_count,
        params: (d.request?.params || []).map((p: any) => ({
          name: p.name, type: p.type, required: p.required, description: p.description, allowed: p.allowed,
        })),
        answer_fields: (d.response?.fields || []).map((f: any) => ({
          name: f.name, type: f.type, unit: f.unit, description: f.user_description || f.description,
        })),
        top_ranked: top.length ? top : "Not ranked yet: an ask goes to a miner the node's LLM picks.",
      });
    }),
  );

  server.registerTool(
    "telegraph_find_miners",
    {
      title: "Find miners",
      description:
        "Miners for an intent, best-ranked first, with status, price and rank; or miners whose name or description " +
        "match some words. Free.",
      inputSchema: {
        intent: z.string().optional().describe("Intent name; lists that intent's miners with their rank."),
        search: z.string().optional().describe("Words every listed miner must match (slug, name, description)."),
        limit: z.number().int().min(1).max(100).optional().describe("Most miners to return (default 20)."),
      },
      annotations: free,
    },
    guard(async ({ intent, search, limit }) => {
      const words = (search || "").toLowerCase().split(/\s+/).filter(Boolean);
      const hit = (m: any) => words.every((w) => `${m.slug} ${m.name} ${m.description}`.toLowerCase().includes(w));
      const n = limit ?? 20;
      if (intent) {
        const id = name(intent);
        const rows: any[] = await getJson(`${cfg.url}/api/miners?intent=${encodeURIComponent(id)}&limit=500`, 60_000);
        const out = rows
          .filter(hit)
          .map((m) => {
            const s = (m.scores || []).find((x: any) => x.intent_id === id);
            return {
              id: m.id, slug: m.slug, name: m.name, status: m.activation_status,
              price_usd: m.min_price_usdc != null ? m.min_price_usdc / 1e6 : undefined,
              rank: s?.rank, score: s ? round(s.score) : undefined, requests_served: m.total_requests_served,
              endpoints: (m.endpoints || []).slice(0, 8).map((e: any) => `${e.method} ${e.path}`),
              description: trim(m.description, 160),
            };
          })
          .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.requests_served ?? 0) - (a.requests_served ?? 0));
        return ok({ intent: id, count: out.length, miners: out.slice(0, n) });
      }
      if (!words.length) return fail("Give an intent, or words to search the miners for.");
      const out = (await miners()).filter(hit);
      return ok({
        count: out.length,
        miners: out.slice(0, n).map((m) => ({
          id: m.id, slug: m.slug, name: m.name, intents: m.capabilities, description: trim(m.description, 160),
        })),
      });
    }),
  );

  server.registerTool(
    "telegraph_ranking",
    {
      title: "Miner ranking",
      description:
        "The latest epoch's miner ranking (scores from the network's own checks), for one intent or the top few of " +
        "every intent. Asks go to the top live miner. Free.",
      inputSchema: {
        intent: z.string().optional().describe("Intent name. Empty: every ranked intent."),
        limit: z.number().int().min(1).max(50).optional().describe("Miners per intent (default 10 for one intent, 3 for all)."),
      },
      annotations: free,
    },
    guard(async ({ intent, limit }) => {
      const q = intent ? `intent=${encodeURIComponent(name(intent))}&limit=${limit ?? 10}` : `limit=${limit ?? 3}`;
      const [board, epoch] = await Promise.all([
        getJson(`${cfg.url}/leaderboard/miners?${q}`),
        getJson(`${cfg.url}/api/epoch`).catch(() => undefined),
      ]);
      const ranked = Object.fromEntries(Object.keys(board.intents || {}).map((k) => [k, rankingRows(board, k)]));
      return ok({
        epoch: board.epoch,
        next_ranking_in: epoch?.time_until_next_epoch,
        intents: Object.keys(ranked).length ? ranked : "Not ranked yet: an ask goes to a miner the node's LLM picks.",
      });
    }),
  );

  server.registerTool(
    "telegraph_account",
    {
      title: "Account",
      description:
        "This server's wallet (or any address): wallet USDC and ETH, and the Telegraph escrow balance that pays for " +
        "asks (spendable, deposited, debt, pending withdrawal). Free.",
      inputSchema: { address: z.string().optional().describe("Address to look up. Default: this server's wallet.") },
      annotations: free,
    },
    guard(async ({ address }) => {
      const who = address || payer?.account.address;
      if (!who) return fail(NO_KEY);
      if (!/^0x[0-9a-fA-F]{40}$/.test(who)) return fail(`Not an address: ${who}`);
      return ok({
        ...(await chain.account(who as `0x${string}`)),
        payment_mode: who === payer?.account.address ? cfg.payment : undefined,
        note:
          "Asks are paid from escrow first (a failed ask is never billed), else by x402 from the wallet's USDC. " +
          "telegraph_deposit moves wallet USDC into escrow.",
      });
    }),
  );

  server.registerTool(
    "telegraph_deposit",
    {
      title: "Deposit to escrow",
      description:
        "Move USDC from this server's wallet into its Telegraph escrow balance (approve, then depositUSDC on chain; " +
        "needs a little ETH for gas). Escrow then pays for asks. Confirm the amount with the user first. Withdrawing " +
        "is explained in telegraph_docs topic payments.",
      inputSchema: { amount_usd: z.number().positive().max(10_000).describe("USDC to deposit, e.g. 1 or 5.") },
      annotations: paid,
    },
    guard(async ({ amount_usd }) => {
      if (!payer) return fail(NO_KEY);
      const result = await chain.deposit(payer.account, amount_usd);
      payer.escrowFunded();
      return ok(result);
    }),
  );

  const topics = guides.map((g) => g.name) as [string, ...string[]];
  server.registerTool(
    "telegraph_docs",
    {
      title: "Telegraph docs",
      description: "How Telegraph works: getting started, payments, intents and ranking, errors. Free.",
      inputSchema: {
        topic: z.enum(topics).optional().describe("A topic to read in full."),
        search: z.string().optional().describe("Words to look up across the docs."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async ({ topic, search }) => {
      if (topic) return ok(guides.find((g) => g.name === topic)!.text);
      if (search) return ok(searchGuides(guides, search) || `Nothing found for "${search}". Topics: ${topics.join(", ")}.`);
      return ok({ topics: guides.map((g) => ({ topic: g.name, title: g.title, about: g.summary })) });
    }),
  );

  for (const g of guides) {
    server.registerResource(
      g.name,
      `telegraph://docs/${g.name}`,
      { title: g.title, description: g.summary, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: g.text }] }),
    );
  }

  return payer;
}

function rankingRows(board: any, intent: string) {
  return ((board?.intents?.[intent] as any[]) || []).map((r) => ({
    rank: r.rank, miner: r.miner_slug, score: round(r.score), status: r.activation_status,
  }));
}

function answer(r: PaidResponse, oneMiner = false): Text {
  const b = r.body && typeof r.body === "object" ? r.body : { error: r.body };
  const payment = r.rail
    ? { rail: r.rail, receipt: r.receipt, ...(r.escrowRefused ? { escrow_skipped: r.escrowRefused } : {}) }
    : undefined;
  if (r.status >= 200 && r.status < 300) {
    return ok({
      answer: b.result,
      intent: b.intent,
      miner: b.miner_name ? `${b.miner_name} (id ${b.miner_id})` : b.miner_id,
      result_shape: b.result_shape,
      field_status: b.field_status,
      cost_usd: b.cost_usd,
      payment,
      warnings: b.warnings,
    });
  }
  return fail(
    JSON.stringify(
      { status: r.status, error: b.error, reason: b.reason, message: b.message, hint: hintFor(r.status, b, oneMiner), node_payment_notice: b.payment, payment },
      null,
      2,
    ),
  );
}

function hintFor(status: number, b: any, oneMiner: boolean): string | undefined {
  const err = String(b?.error || "");
  if (oneMiner && err === "no_compatible_miner") return "This miner can't take that request. Ask it with a question only, or use telegraph_ask.";
  if (err === "no_compatible_miner") return "No live miner serves that intent now. Ask without intent, or pick another (telegraph_find_intents).";
  if (err === "invalid_params") return "The params don't fit the intent. telegraph_intent lists the params it takes.";
  if (err === "no_input_schema") return "This intent takes no params. Send only a question.";
  if (status === 429) return "Too many new questions this minute. Wait a minute, then retry.";
  if (status === 402) return "Payment refused. telegraph_account shows the balances; telegraph_deposit tops up escrow.";
  if (status === 503) return "The node could not route this now. Nothing was charged; try again shortly.";
  if (status >= 500) return "The miner or node failed. Escrow never bills a failed ask; an x402 payment is credited to escrow.";
  return undefined;
}
