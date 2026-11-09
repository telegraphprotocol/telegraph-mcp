// The hosted connector, end to end, against a stand-in for telegraph-backend that
// answers the same calls anjoman.ai makes (auth/login/email, auth/wallet/*,
// auth/me, auth/wallet, agent/payment-methods, agent/chat as server-sent events).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = (sub) => `x.${Buffer.from(JSON.stringify({ sub, exp })).toString("base64url")}.sig`;
const SESSION = { "alice@example.com": jwt("alice"), "broke@example.com": jwt("broke") };
const seen = { chats: [] };

const backend = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  const send = (code, v) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(v));
  const who = Object.entries(SESSION).find(([, t]) => req.headers.authorization === `Bearer ${t}`)?.[0];
  if (req.url === "/auth/login/email") {
    return SESSION[json.email] && json.password === "right" ? send(200, { accessToken: SESSION[json.email], user: { email: json.email } }) : send(401, { message: "Invalid email or password" });
  }
  if (req.url === "/auth/me") return who ? send(200, { email: who, authMethod: "email", refreshToken: "never-show-this" }) : send(401, {});
  if (req.url === "/auth/wallet") return who ? send(200, { address: "0xabc", escrowBalance: who.startsWith("broke") ? "0" : "5.00" }) : send(401, {});
  if (req.url === "/agent/payment-methods") return send(200, { accountType: "email", methods: [{ method: "escrow", default: true }] });
  if (req.url === "/agent/chat") {
    if (!who) return send(401, { message: "Unauthorized" });
    seen.chats.push({ who, body: json });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    ev("conversation", { conversationId: "c1" });
    ev("status", { stage: "routing", message: "Routing" });
    if (who.startsWith("broke")) {
      ev("trace", { steps: [{ intent: "CRYPTO_PRICE_USD", status: "failed", reason: "insufficient_balance", attempts: [{ error: "insufficient escrow balance" }] }] });
      ev("done", { answer: "I couldn't pay for that.", status: "failed" });
    } else {
      ev("trace", { steps: [{ intent: "CRYPTO_PRICE_USD", status: "answered", miner: { slug: "cp", name: "CryptoPulse", rank: 1 }, receipt: { rail: "escrow", amount_usdc: 0.01 } }] });
      ev("token", { text: "BTC is " });
      ev("done", { answer: "BTC is $97,000.", status: "answered", messageId: "m1" });
    }
    return res.end();
  }
  send(404, {});
});

let base, app;
before(async () => {
  await new Promise((r) => backend.listen(0, "127.0.0.1", r));
  process.env.TELEGRAPH_URL = process.env.REMOTE_TEST_NODE || "https://devnode.telegraphprotocol.com";
  const { createRemoteApp } = await import("../dist/remote.js");
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const ex = createRemoteApp({ port: 0, host: "127.0.0.1", publicUrl: new URL(base), backendUrl: `http://127.0.0.1:${backend.address().port}`, appUrl: "https://anjoman.ai", maxAskUsd: 0.5 });
  srv.on("request", ex);
  app = srv;
});
after(() => {
  backend.close();
  app.close();
});

const b64 = (b) => b.toString("base64url");
async function signIn(email, password) {
  const reg = await (await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:6274/cb"], client_name: "Test app", token_endpoint_auth_method: "none" }) })).json();
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "http://localhost:6274/cb", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  const page = await (await fetch(`${base}/authorize?${q}`)).text();
  const pending = page.match(/name="pending" value="([^"]+)"/)?.[1];
  const login = await fetch(`${base}/login/email`, { method: "POST", redirect: "manual", body: new URLSearchParams({ pending, email, password }) });
  return { reg, verifier, page, login };
}
async function fullSignIn(email) {
  const { reg, verifier, login } = await signIn(email, "right");
  const code = new URL(login.headers.get("location")).searchParams.get("code");
  const tok = await (await fetch(`${base}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://localhost:6274/cb", client_id: reg.client_id, code_verifier: verifier }) })).json();
  return tok;
}
async function connect(access) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
  return c;
}
const text = (r) => r.content.map((x) => x.text).join("\n");

test("unauthenticated MCP calls get 401 pointing at the OAuth metadata", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") || "", /oauth-protected-resource\/mcp/);
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(prm.resource, `${base}/mcp`);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.ok(as.authorization_endpoint && as.token_endpoint && as.registration_endpoint);
  assert.ok(as.code_challenge_methods_supported.includes("S256"));
});

test("the sign-in page names the app and a wrong password is refused", async () => {
  const { page, login } = await signIn("alice@example.com", "wrong");
  assert.match(page, /Test app/);
  assert.equal(login.status, 401);
  assert.match(await login.text(), /Invalid email or password/);
});

test("sign in, swap the code for a token, and the token is not the Anjoman session", async () => {
  const tok = await fullSignIn("alice@example.com");
  assert.equal(tok.token_type, "bearer");
  assert.ok(tok.expires_in > 60);
  assert.notEqual(tok.access_token, SESSION["alice@example.com"]);
});

test("a code can't be used twice", async () => {
  const { reg, verifier, login } = await signIn("alice@example.com", "right");
  const code = new URL(login.headers.get("location")).searchParams.get("code");
  const form = () => new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://localhost:6274/cb", client_id: reg.client_id, code_verifier: verifier });
  assert.equal((await fetch(`${base}/token`, { method: "POST", body: form() })).status, 200);
  assert.equal((await fetch(`${base}/token`, { method: "POST", body: form() })).status, 400);
});

test("the connector's tools: ask is paid through the user's account, no wallet tools", async () => {
  const { access_token } = await fullSignIn("alice@example.com");
  const c = await connect(access_token);
  const names = (await c.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("telegraph_ask") && names.includes("telegraph_account"));
  assert.ok(!names.includes("telegraph_deposit") && !names.includes("telegraph_ask_miner"));
  const r = await c.callTool({ name: "telegraph_ask", arguments: { question: "BTC price?" } });
  assert.ok(!r.isError, text(r));
  const out = JSON.parse(text(r));
  assert.equal(out.answer, "BTC is $97,000.");
  assert.equal(out.steps[0].receipt.rail, "escrow");
  const sent = seen.chats.at(-1);
  assert.equal(sent.who, "alice@example.com");
  assert.equal(sent.body.paymentMethod, "escrow");
  assert.equal(sent.body.maxSpendUsd, 0.5);
  const acct = await c.callTool({ name: "telegraph_account", arguments: {} });
  assert.match(text(acct), /dashboard\/account/);
  assert.doesNotMatch(text(acct), /never-show-this|refreshToken/);
  for (const r2 of [r, acct]) assert.ok(!text(r2).includes(SESSION["alice@example.com"]), "the Anjoman session leaked to the app");
  await c.close();
});

test("an empty escrow gets a top-up link, not a payment", async () => {
  const { access_token } = await fullSignIn("broke@example.com");
  const c = await connect(access_token);
  const r = await c.callTool({ name: "telegraph_ask", arguments: { question: "BTC price?" } });
  assert.ok(r.isError);
  assert.match(text(r), /escrow balance too low/);
  assert.match(text(r), /anjoman\.ai\/dashboard\/account/);
  await c.close();
});

test("a made-up token is refused", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer nope", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(r.status, 401);
});

test("health is public and says whether the node answers", async () => {
  const h = await fetch(`${base}/health`);
  assert.equal(h.headers.get("access-control-allow-origin"), "*");
  const j = await h.json();
  assert.equal(j.mcp, `${base}/mcp`);
  assert.equal(typeof j.ok, "boolean");
});
