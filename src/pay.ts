import { randomBytes } from "node:crypto";
import { x402Client, x402HTTPClient, type PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { Dedupe, SpendLog, requestKey } from "./limits.js";

export interface PaidResponse {
  status: number;
  body: any;
  rail?: "escrow" | "x402";
  receipt?: unknown;
  escrowRefused?: string; // why escrow refused the ask (a top-up message, or the reason before an x402 payment)
  priceUsd?: number; // what the node asked for this call
  repeated?: boolean; // answered from an identical ask a moment ago: not paid again
}

const ESCROW_SKIP_MS = 5 * 60_000;
const DEDUPE_MS = 60_000; // an identical ask within this window is not paid again

// Pays a /v1/ask call from the Telegraph escrow balance (a failed request is
// never billed). With TELEGRAPH_PAYMENT=auto or x402 it can also pay by x402
// from the wallet's USDC; that is never the default.
export class Payer {
  readonly account: PrivateKeyAccount;
  private http: x402HTTPClient;
  private escrowEmptyUntil = 0;
  readonly spent: SpendLog;
  private dedupe: Dedupe<PaidResponse>;

  constructor(private cfg: Config, key: `0x${string}`) {
    this.account = privateKeyToAccount(key);
    const client = new x402Client();
    client.register("eip155:*", new ExactEvmScheme(toClientEvmSigner(this.account)));
    this.http = new x402HTTPClient(client);
    this.spent = new SpendLog(cfg.home);
    this.dedupe = new Dedupe(DEDUPE_MS);
  }

  // A deposit may have filled the escrow: try it again on the next call.
  escrowFunded() {
    this.escrowEmptyUntil = 0;
  }

  // An identical ask while one is running, or soon after one succeeded, gets
  // that answer back instead of being paid again.
  async post(path: string, body: unknown): Promise<PaidResponse> {
    const ok = (r: PaidResponse) => r.status >= 200 && r.status < 300;
    const { value, repeated } = await this.dedupe.run(requestKey(path, body), ok, () => this.pay(path, body));
    return repeated ? { ...value, repeated: true } : value;
  }

  // Refuses to sign a payment over the per-ask or the daily limit.
  private allow(usd: number) {
    const { maxAskUsd: max, dailyLimitUsd: daily } = this.cfg;
    const today = this.spent.today();
    if (max > 0 && usd > max) throw new Error(`This ask costs $${usd}, over the $${max} limit per ask (TELEGRAPH_MAX_ASK_USD). Nothing was paid.`);
    if (daily > 0 && today + usd > daily) {
      throw new Error(
        `Today's asks have cost $${today}; this one ($${usd}) would pass the $${daily} daily limit ` +
          "(TELEGRAPH_DAILY_LIMIT_USD). Nothing was paid. The limit resets at midnight UTC.",
      );
    }
  }

  private async pay(path: string, body: unknown): Promise<PaidResponse> {
    const send = (headers: Record<string, string> = {}) =>
      fetch(this.cfg.url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

    const first = await send();
    if (first.status !== 402) return { status: first.status, body: await readJson(first) };
    const required = this.http.getPaymentRequiredResponse((h) => first.headers.get(h), await readJson(first));

    let escrowRefused: string | undefined;
    const escrow = required.accepts.find((a) => a.scheme === "escrow");
    const tryEscrow = this.cfg.payment === "escrow" || (this.cfg.payment === "auto" && Date.now() >= this.escrowEmptyUntil);
    if (escrow && tryEscrow) {
      const priceUsd = usdOf(escrow.amount);
      this.allow(priceUsd);
      const res = await send({ "X-PAYMENT": await this.escrowHeader(escrow) });
      const resBody = await readJson(res);
      if (res.status >= 200 && res.status < 300) this.spent.add(priceUsd); // escrow bills only a delivered ask
      if (res.status !== 402 || this.cfg.payment === "escrow") {
        const refused = res.status === 402 ? String(resBody?.reason || resBody?.error || "refused") : undefined;
        return { status: res.status, body: resBody, rail: "escrow", receipt: receiptOf(res), escrowRefused: refused, priceUsd };
      }
      escrowRefused = String(resBody?.reason || resBody?.error || "refused");
      if (escrowRefused.includes("insufficient")) this.escrowEmptyUntil = Date.now() + ESCROW_SKIP_MS;
    }

    // Escrow mode never falls back to the wallet; and the node may offer no
    // escrow payment at all (an older node, or escrow turned off there).
    const exact = required.accepts.filter((a) => a.scheme === "exact");
    if (this.cfg.payment === "escrow" || exact.length === 0) {
      throw new Error(
        `The node offered no payment this wallet may make (TELEGRAPH_PAYMENT=${this.cfg.payment}); ` +
          "escrow mode never pays from the wallet. TELEGRAPH_PAYMENT=auto allows x402.",
      );
    }
    const priceUsd = usdOf(exact[0].amount);
    this.allow(priceUsd);
    const payload = await this.http.createPaymentPayload({ ...required, accepts: exact });
    const res = await send(this.http.encodePaymentSignatureHeader(payload));
    this.spent.add(priceUsd); // x402 settles before the miner runs; a failed ask is credited to escrow
    return { status: res.status, body: await readJson(res), rail: "x402", receipt: receiptOf(res), escrowRefused, priceUsd };
  }

  // The scheme "escrow" X-PAYMENT header: a personal_sign of the challenge's
  // message. It proves intent only; it can't move funds.
  private async escrowHeader(req: PaymentRequirements): Promise<string> {
    const template = String((req.extra as any)?.message || "");
    if (!template) throw new Error("the escrow challenge has no message to sign");
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: this.account.address,
      to: req.payTo,
      value: req.amount,
      validAfter: String(now - 10),
      validBefore: String(now + 60), // the node allows a window of 2 minutes at most
      nonce: "0x" + randomBytes(32).toString("hex"),
    };
    // The node rebuilds the message with the wallet lowercased.
    const message = template
      .replaceAll("{from}", authorization.from.toLowerCase())
      .replaceAll("{nonce}", authorization.nonce)
      .replaceAll("{validAfter}", authorization.validAfter)
      .replaceAll("{validBefore}", authorization.validBefore);
    const signature = await this.account.signMessage({ message });
    const envelope = { x402Version: 2, scheme: "escrow", network: req.network, payload: { signature, authorization } };
    return Buffer.from(JSON.stringify(envelope)).toString("base64");
  }
}

// Challenge amounts are micro-USDC strings.
const usdOf = (amount: unknown) => Number(amount ?? 0) / 1e6;

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The payment receipt: X-PAYMENT-RESPONSE for escrow, PAYMENT-RESPONSE for x402.
function receiptOf(res: Response): unknown {
  const header = res.headers.get("PAYMENT-RESPONSE") || res.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return undefined;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}
