import { randomBytes } from "node:crypto";
import { x402Client, x402HTTPClient, type PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Config } from "./config.js";

export interface PaidResponse {
  status: number;
  body: any;
  rail?: "escrow" | "x402";
  receipt?: unknown;
  escrowRefused?: string; // why escrow was skipped before paying by x402
}

const ESCROW_SKIP_MS = 5 * 60_000;

// Pays a /v1/ask call: from the Telegraph escrow balance when it can (a failed
// request is never billed), else by x402 from the wallet's USDC.
export class Payer {
  readonly account: PrivateKeyAccount;
  private http: x402HTTPClient;
  private escrowEmptyUntil = 0;

  constructor(private cfg: Config, key: `0x${string}`) {
    this.account = privateKeyToAccount(key);
    const client = new x402Client();
    client.register("eip155:*", new ExactEvmScheme(toClientEvmSigner(this.account)));
    this.http = new x402HTTPClient(client);
  }

  // A deposit may have filled the escrow: try it again on the next call.
  escrowFunded() {
    this.escrowEmptyUntil = 0;
  }

  async post(path: string, body: unknown): Promise<PaidResponse> {
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
      const res = await send({ "X-PAYMENT": await this.escrowHeader(escrow) });
      const resBody = await readJson(res);
      if (res.status !== 402 || this.cfg.payment === "escrow") {
        return { status: res.status, body: resBody, rail: "escrow", receipt: receiptOf(res) };
      }
      escrowRefused = String(resBody?.reason || resBody?.error || "refused");
      if (escrowRefused.includes("insufficient")) this.escrowEmptyUntil = Date.now() + ESCROW_SKIP_MS;
    }

    const exact = required.accepts.filter((a) => a.scheme === "exact");
    if (exact.length === 0 || this.cfg.payment === "escrow") {
      throw new Error(`The node offered no payment this wallet can make (TELEGRAPH_PAYMENT=${this.cfg.payment}).`);
    }
    const payload = await this.http.createPaymentPayload({ ...required, accepts: exact });
    const res = await send(this.http.encodePaymentSignatureHeader(payload));
    return { status: res.status, body: await readJson(res), rail: "x402", receipt: receiptOf(res), escrowRefused };
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
