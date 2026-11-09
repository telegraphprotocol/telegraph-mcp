import { createHash, randomBytes } from "node:crypto";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { loadConfig } from "./config.js";
import { fail, ok, registerTools, type RemoteAccount, type Text } from "./tools.js";

// The hosted MCP server for connectors (Claude, ChatGPT, Grok and any client that
// takes a URL). Each person signs in with their Anjoman account through OAuth;
// paid asks then go through telegraph-backend with their session, paid from
// their own escrow, exactly as on anjoman.ai. This server never holds a wallet
// key, and it keeps sessions in memory only: a restart means signing in again.

export interface RemoteSettings {
  port: number;
  host: string;
  publicUrl: URL; // how clients reach this server, e.g. https://mcp.telegraphprotocol.com
  backendUrl: string; // telegraph-backend, the service behind anjoman.ai/api
  appUrl: string; // anjoman.ai, for top-up and sign-up links
  maxAskUsd: number; // the spending cap sent with each ask
}

export function remoteSettings(env: NodeJS.ProcessEnv = process.env): RemoteSettings {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`${k} is required for the hosted server`);
    return v;
  };
  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || "0.0.0.0",
    publicUrl: new URL(need("TELEGRAPH_MCP_PUBLIC_URL")),
    backendUrl: need("TELEGRAPH_BACKEND_URL").replace(/\/+$/, ""),
    appUrl: (env.TELEGRAPH_APP_URL || "https://anjoman.ai").replace(/\/+$/, ""),
    maxAskUsd: Number(env.TELEGRAPH_MAX_ASK_USD || 0.5),
  };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const MINUTE = 60_000;

interface Session {
  clientId: string;
  backendToken: string; // the Anjoman session; never sent to the client
  expiresAt: number; // ms
  scopes: string[];
}

// When the Anjoman session ends (from its JWT, if it says), capped at 30 days.
function sessionExpiry(backendToken: string): number {
  const cap = Date.now() + 30 * 24 * 60 * MINUTE;
  try {
    const exp = JSON.parse(Buffer.from(backendToken.split(".")[1], "base64url").toString()).exp;
    if (typeof exp === "number") return Math.min(exp * 1000, cap);
  } catch {
    /* not a JWT: use the cap */
  }
  return cap;
}

class Provider implements OAuthServerProvider {
  private clients = new Map<string, OAuthClientInformationFull>();
  readonly pending = new Map<string, { client: OAuthClientInformationFull; params: AuthorizationParams; until: number }>();
  private codes = new Map<string, { clientId: string; params: AuthorizationParams; backendToken: string; until: number }>();
  private sessions = new Map<string, Session>(); // keyed by sha256 of the access token

  constructor(private s: RemoteSettings) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (id) => this.clients.get(id),
      // Dynamic client registration: the app (Claude, ChatGPT, Grok) registers itself; the id is ours to give.
      registerClient: async (client) => {
        const full = { ...client, client_id: (client as any).client_id || token(), client_id_issued_at: Math.floor(Date.now() / 1000) } as OAuthClientInformationFull;
        this.clients.set(full.client_id, full);
        return full;
      },
    };
  }

  // Shows the sign-in page; the sign-in itself posts to /login/*.
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const id = token();
    this.pending.set(id, { client, params, until: Date.now() + 15 * MINUTE });
    res.status(200).type("html").send(loginPage(id, client.client_name || "An AI app", this.s.appUrl));
  }

  // A sign-in succeeded: hand the app an authorization code.
  finish(pendingId: string, backendToken: string): string {
    const p = this.pending.get(pendingId);
    this.pending.delete(pendingId);
    if (!p || p.until < Date.now()) throw new Error("This sign-in page has expired. Start again from your app.");
    const code = token();
    this.codes.set(code, { clientId: p.client.client_id, params: p.params, backendToken, until: Date.now() + 5 * MINUTE });
    const back = new URL(p.params.redirectUri);
    back.searchParams.set("code", code);
    if (p.params.state) back.searchParams.set("state", p.params.state);
    return back.href;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    const c = this.codes.get(code);
    if (!c || c.clientId !== client.client_id) throw new InvalidGrantError("Unknown authorization code");
    return c.params.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const c = this.codes.get(code);
    this.codes.delete(code);
    if (!c || c.clientId !== client.client_id || c.until < Date.now()) throw new InvalidGrantError("Invalid or expired authorization code");
    if (redirectUri && redirectUri !== c.params.redirectUri) throw new InvalidGrantError("redirect_uri does not match");
    const access = token();
    const expiresAt = sessionExpiry(c.backendToken);
    this.sessions.set(sha(access), { clientId: client.client_id, backendToken: c.backendToken, expiresAt, scopes: c.params.scopes || [] });
    return { access_token: access, token_type: "bearer", expires_in: Math.max(60, Math.floor((expiresAt - Date.now()) / 1000)) };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new InvalidGrantError("No refresh tokens: sign in again.");
  }

  async verifyAccessToken(access: string): Promise<AuthInfo> {
    const s = this.sessions.get(sha(access));
    if (!s || s.expiresAt < Date.now()) throw new InvalidTokenError("Signed out or expired: sign in again.");
    return { token: access, clientId: s.clientId, scopes: s.scopes, expiresAt: Math.floor(s.expiresAt / 1000), extra: { backendToken: s.backendToken } };
  }

  async revokeToken(_client: OAuthClientInformationFull, req: { token: string }) {
    this.sessions.delete(sha(req.token));
  }
}

// What the signed-in person's Anjoman account does for the tools.
function accountFor(s: RemoteSettings, backendToken: string): RemoteAccount {
  const auth = { Authorization: `Bearer ${backendToken}` };
  const topUp = `${s.appUrl}/dashboard/account`;
  return {
    async ask(a) {
      const message = a.question || `${a.intent}: ${JSON.stringify(a.params ?? {})}`;
      const res = await fetch(`${s.backendUrl}/agent/chat`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message,
          ...(a.intent ? { intent: a.intent.toUpperCase() } : {}),
          ...(a.params ? { params: a.params } : {}),
          paymentMethod: "escrow",
          maxSpendUsd: s.maxAskUsd,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 401) return fail("Your Anjoman sign-in has expired. Reconnect Telegraph in this app's connector settings.");
      if (!res.ok || !res.body) return fail(`Telegraph could not take the ask (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
      const r = await readAgentStream(res);
      const steps = r.steps.map((st: any) => ({
        intent: st.intent,
        status: st.status,
        miner: st.miner ? `${st.miner.name ?? st.miner.slug}${st.miner.rank ? ` (rank ${st.miner.rank})` : ""}` : undefined,
        receipt: st.receipt,
        ...(st.status !== "answered" ? { reason: st.reason, error: st.attempts?.map((x: any) => x.error).filter(Boolean)[0] } : {}),
      }));
      const short = /insufficient\s+(usdc\s+|escrow\s+)?balance|insufficient_balance/i.test(JSON.stringify(r.steps) + (r.error || ""));
      if (short) {
        return fail(JSON.stringify({ error: "escrow balance too low", what_to_do: `Ask the user to add USDC to their escrow at ${topUp}, then ask again. Nothing was charged for the failed step.`, steps }, null, 2));
      }
      if (r.error || !r.done) return fail(r.error || "The answer stopped before it finished. Ask again.");
      return ok({ answer: r.answer ?? r.streamed, status: r.done?.status, steps, paid_from: "your Anjoman escrow", conversation: r.conversationId });
    },
    async account() {
      const get = async (path: string) => {
        const res = await fetch(`${s.backendUrl}${path}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
        if (res.status === 401) throw new Error("Your Anjoman sign-in has expired. Reconnect Telegraph in this app's connector settings.");
        return res.ok ? res.json() : undefined;
      };
      const [me, wallet, methods] = await Promise.all([get("/auth/me"), get("/auth/wallet").catch(() => undefined), get("/agent/payment-methods").catch(() => undefined)]);
      return ok({ account: strip(me), wallet: strip(wallet), payment_methods: methods, top_up: `Add USDC to escrow at ${topUp}. Asks are paid from it automatically.` });
    },
  };
}

// Anything that looks like a credential stays out of what the model sees.
function strip(v: any): any {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(strip);
  return Object.fromEntries(Object.entries(v).filter(([k]) => !/token|secret|password|private/i.test(k)).map(([k, x]) => [k, strip(x)]));
}

async function readAgentStream(res: globalThis.Response) {
  const out: { steps: any[]; answer?: string; streamed: string; done?: any; error?: string; conversationId?: string } = { steps: [], streamed: "" };
  const text = await res.text();
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    let d: any;
    try {
      d = JSON.parse(data.join("\n"));
    } catch {
      continue;
    }
    if (event === "conversation" && typeof d.conversationId === "string") out.conversationId = d.conversationId;
    else if (event === "token" && typeof d.text === "string") out.streamed += d.text;
    else if (event === "trace" && Array.isArray(d.steps)) out.steps.push(...d.steps);
    else if (event === "done") {
      out.done = d;
      if (typeof d.answer === "string") out.answer = d.answer;
    } else if (event === "error") out.error = typeof d.message === "string" ? d.message : "The answer failed.";
  }
  return out;
}

export function createRemoteApp(s: RemoteSettings) {
  const cfg = loadConfig({ ...process.env, TELEGRAPH_PRIVATE_KEY: "", TELEGRAPH_EVM_PRIVATE_KEY: "", TELEGRAPH_HOME: "/nonexistent-telegraph-home" });
  const provider = new Provider(s);
  const mcpUrl = new URL("/mcp", s.publicUrl);
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: s.publicUrl,
      resourceServerUrl: mcpUrl,
      resourceName: "Telegraph",
      serviceDocumentationUrl: new URL("https://github.com/telegraphprotocol/telegraph-mcp"),
    }),
  );

  // The sign-in page's two ways in: Anjoman email and password, or a wallet signature.
  app.post("/login/email", express.urlencoded({ extended: false, limit: "8kb" }), async (req: Request, res: Response) => {
    const { pending, email, password } = req.body ?? {};
    try {
      const r = await fetch(`${s.backendUrl}/auth/login/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(20_000),
      });
      const body: any = await r.json().catch(() => ({}));
      const session = body.accessToken ?? body.token;
      if (!r.ok || typeof session !== "string") throw new Error(body.message || "Sign-in failed. Check your email and password.");
      res.redirect(302, provider.finish(String(pending), session));
    } catch (e: any) {
      const p = provider.pending.get(String(pending));
      res.status(p ? 401 : 400).type("html").send(loginPage(String(pending), p?.client.client_name || "An AI app", s.appUrl, e.message));
    }
  });
  app.post("/login/wallet/message", express.json({ limit: "4kb" }), async (req: Request, res: Response) => {
    const r = await fetch(`${s.backendUrl}/auth/wallet/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: String(req.body?.address || "") }),
      signal: AbortSignal.timeout(20_000),
    });
    res.status(r.status).json(await r.json().catch(() => ({})));
  });
  app.post("/login/wallet", express.json({ limit: "8kb" }), async (req: Request, res: Response) => {
    const { pending, message, signature, nonceId } = req.body ?? {};
    try {
      const r = await fetch(`${s.backendUrl}/auth/wallet/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, nonceId }),
        signal: AbortSignal.timeout(20_000),
      });
      const body: any = await r.json().catch(() => ({}));
      const session = body.accessToken ?? body.token;
      if (!r.ok || typeof session !== "string") throw new Error(body.message || "Wallet sign-in failed.");
      res.json({ redirect: provider.finish(String(pending), session) });
    } catch (e: any) {
      res.status(401).json({ error: e.message });
    }
  });

  // Live status for the Integrations page.
  app.get("/health", async (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    const node = await fetch(`${cfg.url}/api/epoch`, { signal: AbortSignal.timeout(8_000) })
      .then(async (r) => (r.ok ? ((await r.json()) as any).current_epoch : undefined))
      .catch(() => undefined);
    res.json({ ok: node !== undefined, server: "telegraph-mcp", mcp: mcpUrl.href, node: cfg.url, epoch: node, auth: "oauth (Anjoman account)" });
  });

  // One stateless MCP exchange per request, with the caller's Anjoman session.
  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
  app.post("/mcp", bearer, express.json({ limit: "1mb" }), async (req: Request, res: Response) => {
    const backendToken = (req as any).auth?.extra?.backendToken as string;
    const server = new McpServer({ name: "telegraph", version: VERSION }, { instructions: REMOTE_INSTRUCTIONS });
    registerTools(server, cfg, accountFor(s, backendToken));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (_req: Request, res: Response) => res.status(405).set("Allow", "POST").json({ error: "Use POST /mcp" });
  app.get("/mcp", bearer, notAllowed);
  app.delete("/mcp", bearer, notAllowed);
  return app;
}

let VERSION = "2";
const REMOTE_INSTRUCTIONS =
  "Telegraph is a network of miners (APIs and models) that answer questions by intent, ranked every epoch by the " +
  "network's own checks. Use telegraph_ask for live facts (prices, FX, weather, search) and specialist answers; it is " +
  "paid automatically from the signed-in user's Anjoman escrow. The find, intent, miner, ranking and docs tools are free. " +
  "telegraph_account shows the account and how to top up.";

export async function serveRemote(version: string) {
  VERSION = version;
  const s = remoteSettings();
  const app = createRemoteApp(s);
  app.listen(s.port, s.host, () => console.error(`[telegraph-mcp] hosted v${version} on ${s.host}:${s.port}, public ${s.publicUrl.href}mcp, backend ${s.backendUrl}`));
}

function loginPage(pending: string, app: string, appUrl: string, error?: string): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Telegraph</title><style>
body{font-family:system-ui,sans-serif;background:#0f1220;color:#e8eaf2;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#171b2e;border-radius:14px;padding:28px;max-width:380px;width:100%}h1{font-size:20px;margin:0 0 6px}p{color:#a8adc4;font-size:14px;line-height:1.5}
label{display:block;font-size:13px;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #2c3352;background:#0f1220;color:#e8eaf2}
button{width:100%;padding:11px;border-radius:8px;border:0;margin-top:16px;font-weight:600;cursor:pointer;background:#e8eaf2;color:#0f1220}
button.alt{background:#2c3352;color:#e8eaf2}.err{color:#ff8f8f;font-size:13px}a{color:#9fb4ff}hr{border:0;border-top:1px solid #2c3352;margin:20px 0}
</style></head><body><main>
<h1>Connect Telegraph</h1><p><b>${esc(app)}</b> wants to use Telegraph for you. Sign in with your Anjoman account. Asks are paid from your Anjoman escrow; this server never sees a wallet key.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/login/email"><input type="hidden" name="pending" value="${esc(pending)}">
<label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form>
<hr><button class="alt" id="w" type="button">Sign in with a wallet</button><p class="err" id="we"></p>
<p>No account? <a href="${esc(appUrl)}/auth?mode=signup" target="_blank" rel="noopener">Create one on Anjoman</a>, then come back.</p>
</main><script>
document.getElementById("w").onclick=async()=>{const e=document.getElementById("we");e.textContent="";try{
if(!window.ethereum)throw new Error("No browser wallet found.");
const [address]=await window.ethereum.request({method:"eth_requestAccounts"});
const m=await (await fetch("/login/wallet/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address})})).json();
if(!m.message)throw new Error(m.message||"Could not start wallet sign-in.");
const signature=await window.ethereum.request({method:"personal_sign",params:[m.message,address]});
const r=await (await fetch("/login/wallet",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pending:${JSON.stringify(pending)},message:m.message,signature,nonceId:m.nonceId})})).json();
if(!r.redirect)throw new Error(r.error||"Wallet sign-in failed.");location.href=r.redirect;}catch(x){e.textContent=x.message||String(x)}};
</script></body></html>`;
}

export type { Text };
