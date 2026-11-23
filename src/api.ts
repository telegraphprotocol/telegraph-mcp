import type { KeyPayment } from "./config.js";

// Key mode: asks go through the user's Anjoman account, which pays for them itself — from its escrow balance, or
// x402 from its Solana or EVM address: the agent (agent chat), an auto-routed ask (the node picks the miner) or a
// miner call (one named miner). No wallet, signature or chain call happens in this process.

/** The body fields that choose how the account pays. Escrow is the account's default, so it needs none. */
export function paymentFields(payment: KeyPayment): Record<string, string> {
  return payment === "escrow" ? {} : { paymentMethod: "x402", network: payment };
}

const ASK_WAIT_MS = 110_000; // the API answers at once or hands back a job within about 80 seconds
const POLL_EVERY_MS = 3_000;
const POLL_FOR_MS = 5 * 60_000; // how long a job handed back is followed before giving up (it keeps running)

export interface AskArgs {
  message: string;
  intent?: string;
  params?: Record<string, unknown>;
  paymentMethod?: string;
  network?: string;
}

// The body of an auto-routed ask or a miner call, as the node takes it (the account adds the budget itself).
export type EngineBody = Record<string, unknown>;

// What the account returns for an auto-routed ask or a miner call: the node's reply and its payment receipt.
export interface EngineResult {
  result: any;
  receipt: unknown;
}

export interface AskResult {
  status: string;
  answer?: string;
  sources?: unknown;
  costUsd?: number | null;
  conversationId?: string;
  jobId?: string;
  // Set when the job was still running when polling stopped: where to read it from later.
  note?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AnjomanApi {
  constructor(
    private baseUrl: string,
    private key: string,
  ) {}

  // The API's own message is passed on, since it says what is wrong (revoked key, empty balance, rate limit).
  private async request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; body: any }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
    if (!res.ok) {
      const message = Array.isArray(parsed.message) ? parsed.message.join(", ") : parsed.message || parsed.error || `status ${res.status}`;
      throw new Error(`${res.status} from ${path}: ${message}`);
    }
    return { status: res.status, body: parsed };
  }

  async ask(args: AskArgs): Promise<AskResult> {
    const { status, body } = await this.request("POST", "/agent/chat", { ...args, stream: false }, ASK_WAIT_MS);
    if (status !== 202) return this.result(body);
    return this.follow(body.jobId, body.conversationId);
  }

  // Auto-routed: the node picks the best-ranked live miner and asks the next ones for what it missed, within the
  // account's budget of 0.26 USDC per ask (only the miners whose answers are used are billed). Paid on Solana it
  // goes without the budget: one miner answers.
  async askAuto(body: EngineBody): Promise<EngineResult> {
    return (await this.request("POST", "/engine/ask", body, ASK_WAIT_MS)).body;
  }

  // Miner call: one named miner, no routing and no fallback, at that miner's price.
  async askMiner(miner: string, body: EngineBody): Promise<EngineResult> {
    return (await this.request("POST", `/engine/ask/${encodeURIComponent(miner)}`, body, ASK_WAIT_MS)).body;
  }

  // The turn outlived the wait: read its job until it ends.
  private async follow(jobId: string, conversationId?: string): Promise<AskResult> {
    const until = Date.now() + POLL_FOR_MS;
    while (Date.now() < until) {
      await sleep(POLL_EVERY_MS);
      const { body } = await this.request("GET", `/agent/jobs/${encodeURIComponent(jobId)}`);
      if (body.status !== "running") return this.result({ ...body, jobId, conversationId });
    }
    return {
      status: "running",
      jobId,
      conversationId,
      note: `Still running after ${POLL_FOR_MS / 60_000} minutes. It keeps going and is paid for only if it answers; read it later with GET /agent/jobs/${jobId}.`,
    };
  }

  private result(b: any): AskResult {
    return {
      status: b.status,
      answer: b.answer,
      sources: b.sources,
      costUsd: b.costUsd ?? null,
      conversationId: b.conversationId,
      jobId: b.jobId ?? b.id,
    };
  }

  // What is left to spend, and what the last few jobs cost.
  async account() {
    const [balance, spend] = await Promise.all([this.request("GET", "/engine/escrow/balance"), this.request("GET", "/agent/spend?limit=5")]);
    const b = balance.body;
    return {
      mode: "Anjoman account, through an API key",
      // spendable = in escrow − not yet charged − a requested withdrawal (the node's ledger keeps no debt).
      escrow: {
        spendable_usd: b.effectiveBalance,
        in_escrow_usd: b.escrowBalance,
        not_yet_charged_usd: b.unbilled ?? "0",
        withdrawal_requested: b.withdrawal ?? null,
      },
      totals: spend.body.totals,
      recent_jobs: (spend.body.jobs || []).map((j: any) => ({ status: j.status, cost_usd: j.costUsd, at: j.startedAt })),
      top_up:
        "Add funds in Anjoman: sign in, then use Deposit in the wallet menu. Asks paid with x402 on Solana come from the " +
        "account's Solana address instead (in the same menu; free test USDC at https://faucet.circle.com). This server cannot deposit.",
    };
  }
}
