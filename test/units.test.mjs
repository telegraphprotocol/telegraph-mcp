import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";
import { saveWallet, readWalletKey, newKey, walletPath, walletUnreadable } from "../dist/wallet.js";
import { Dedupe, SpendLog, requestKey } from "../dist/limits.js";
import { AnjomanApi } from "../dist/api.js";
import { keyAnswer, keyEngineAnswer, routedAskBody } from "../dist/tools.js";
import { Payer, billedOf } from "../dist/pay.js";

const home = () => mkdtempSync(join(tmpdir(), "tg-mcp-"));

test("escrow is the default payment, and x402 only when asked for", () => {
  assert.equal(loadConfig({ TELEGRAPH_HOME: home() }).payment, "escrow");
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_PAYMENT: "auto" }).payment, "auto");
  assert.throws(() => loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_PAYMENT: "card" }));
});

test("default limits, and the agent gets no deposit tool unless allowed", () => {
  const c = loadConfig({ TELEGRAPH_HOME: home() });
  assert.equal(c.maxAskUsd, 0.5);
  assert.equal(c.dailyLimitUsd, 5);
  assert.equal(c.agentDeposit, false);
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_ALLOW_AGENT_DEPOSIT: "true" }).agentDeposit, true);
  assert.throws(() => loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_DAILY_LIMIT_USD: "-1" }));
});

test("the wallet file is private, read back, and never overwritten", () => {
  const h = home();
  const key = newKey();
  const address = saveWallet(h, key);
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(statSync(walletPath(h)).mode & 0o777, 0o600);
  assert.equal(statSync(h).mode & 0o777, 0o700);
  assert.equal(readWalletKey(h), key);
  assert.throws(() => saveWallet(h, newKey()), /already exists/);
  assert.equal(readWalletKey(h), key, "the first wallet is untouched");
  assert.throws(() => saveWallet(home(), "0x1234"), /64 hex/);
});

test("the config takes the key from the wallet file, and an env key wins", () => {
  const h = home();
  const key = newKey();
  saveWallet(h, key);
  const fromFile = loadConfig({ TELEGRAPH_HOME: h });
  assert.equal(fromFile.privateKey, key);
  const other = newKey();
  assert.equal(loadConfig({ TELEGRAPH_HOME: h, TELEGRAPH_PRIVATE_KEY: other }).privateKey, other, "an env key wins");
  assert.equal(loadConfig({ TELEGRAPH_HOME: home() }).privateKey, undefined);
});

test("spending is recorded per day and survives a restart", () => {
  const h = home();
  const a = new SpendLog(h);
  assert.equal(a.today(), 0);
  a.add(0.01);
  a.add(0.02);
  assert.equal(new SpendLog(h).today(), 0.03);
  assert.equal(statSync(join(h, "spend.json")).mode & 0o777, 0o600);
});

test("an identical ask is paid once: in flight, and just after success", async () => {
  const d = new Dedupe(60_000);
  let calls = 0;
  const pay = () => new Promise((r) => setTimeout(() => r({ status: 200, n: ++calls }), 30));
  const ok = (v) => v.status === 200;
  const [x, y] = await Promise.all([d.run("k", ok, pay), d.run("k", ok, pay)]);
  assert.equal(calls, 1);
  assert.equal(x.repeated, false);
  assert.equal(y.repeated, true);
  const z = await d.run("k", ok, pay);
  assert.equal(calls, 1, "answered from the last result");
  assert.equal(z.repeated, true);
  await d.run("other", ok, pay);
  assert.equal(calls, 2);
});

test("a failed ask is not cached, so retrying it really retries", async () => {
  const d = new Dedupe(60_000);
  let calls = 0;
  const fail = async () => ({ status: 503, n: ++calls });
  await d.run("k", (v) => v.status === 200, fail);
  await d.run("k", (v) => v.status === 200, fail);
  assert.equal(calls, 2);
});

test("the request key ignores key order", () => {
  assert.equal(requestKey("/a", { x: 1, y: { b: 2, a: 1 } }), requestKey("/a", { y: { a: 1, b: 2 }, x: 1 }));
  assert.notEqual(requestKey("/a", { x: 1 }), requestKey("/b", { x: 1 }));
});

test("a damaged wallet file gives no key instead of throwing", () => {
  const h = home();
  writeFileSync(walletPath(h), "{ not json");
  assert.equal(readWalletKey(h), undefined, "no key, and no exception");
  assert.equal(walletUnreadable(h), true);
  assert.equal(loadConfig({ TELEGRAPH_HOME: h }).privateKey, undefined, "the free tools still start");
  assert.equal(walletUnreadable(home()), false, "no file at all is not a damaged file");
});

test("a reservation is counted at once and given back", () => {
  const h = home();
  const s = new SpendLog(h);
  s.add(0.02);
  assert.equal(s.today(), 0.02, "counted before the ask is answered");
  s.add(-0.02);
  assert.equal(s.today(), 0, "given back when nothing was charged");
  s.add(-5);
  assert.equal(s.today(), 0, "never goes below zero");
});

test("answers past the dedupe window are dropped, not kept for ever", async () => {
  const d = new Dedupe(20);
  const ok = () => true;
  await d.run("a", ok, async () => 1);
  await new Promise((r) => setTimeout(r, 40));
  await d.run("b", ok, async () => 2);
  assert.equal(d.size, 1, "only the live answer is held");
});

const KEY = "anjoman_" + "a".repeat(43);

test("an API key switches to key mode, is checked, and points at the Anjoman API by default", () => {
  const c = loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: ` ${KEY} ` });
  assert.equal(c.apiKey, KEY);
  assert.equal(c.apiUrl, "https://backend.telegraphprotocol.com");
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: KEY, TELEGRAPH_API_URL: "http://localhost:4100/" }).apiUrl, "http://localhost:4100");
  assert.equal(loadConfig({ TELEGRAPH_HOME: home() }).apiKey, undefined, "wallet mode without one");
  assert.throws(() => loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: "0x" + "1".repeat(64) }), /starts with anjoman_/);
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: "tgk_" + "a".repeat(43) }).apiKey, "tgk_" + "a".repeat(43), "keys made before the prefix changed still work");
});

// A stand-in for the Anjoman API: replies in order, and records what it was asked.
function fakeApi(replies) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, auth: init.headers.Authorization, body: init.body && JSON.parse(init.body) });
    const [status, body] = replies.shift();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("key mode asks the account for one JSON reply, sending the key and nothing else", async () => {
  const api = fakeApi([[200, { conversationId: "c1", jobId: "j1", messageId: "m1", answer: "42", status: "complete", sources: [], costUsd: 0.01 }]]);
  try {
    const r = await new AnjomanApi("http://api.test", KEY).ask({ message: "what is 6x7?" });
    assert.deepEqual(api.calls[0], { url: "http://api.test/agent/chat", method: "POST", auth: `Bearer ${KEY}`, body: { message: "what is 6x7?", stream: false } });
    assert.equal(r.answer, "42");
    assert.equal(r.costUsd, 0.01);
    assert.equal(keyAnswer(r).isError, undefined);
  } finally {
    api.restore();
  }
});

test("key mode follows a job handed back (202) until it ends", { timeout: 20_000 }, async () => {
  const api = fakeApi([
    [202, { status: "running", jobId: "j1", conversationId: "c1" }],
    [200, { id: "j1", status: "running" }],
    [200, { id: "j1", status: "completed", answer: "late answer", costUsd: 0.02 }],
  ]);
  try {
    const r = await new AnjomanApi("http://api.test", KEY).ask({ message: "slow one" });
    assert.deepEqual(api.calls.map((c) => c.method + " " + c.url.replace("http://api.test", "")), ["POST /agent/chat", "GET /agent/jobs/j1", "GET /agent/jobs/j1"]);
    assert.equal(r.answer, "late answer");
    assert.equal(r.jobId, "j1");
    assert.equal(r.conversationId, "c1");
  } finally {
    api.restore();
  }
});

test("key mode passes the API's own reason on when it refuses", async () => {
  const api = fakeApi([[401, { message: "This API key has been revoked. Create a new one in Anjoman.", statusCode: 401 }]]);
  try {
    await assert.rejects(new AnjomanApi("http://api.test", KEY).ask({ message: "hi" }), /401 from \/agent\/chat: This API key has been revoked/);
  } finally {
    api.restore();
  }
});

test("key mode shows the balance and recent spend, and says how to top up", async () => {
  const api = fakeApi([
    [200, { effectiveBalance: "1.5", escrowBalance: "2", agentDebt: "0" }],
    [200, { totals: [{ usageKind: "paid", jobs: 1, costUsd: 0.01 }], jobs: [{ status: "completed", costUsd: 0.01, startedAt: "2026-11-16T00:00:00Z", question: "private" }] }],
  ]);
  try {
    const a = await new AnjomanApi("http://api.test", KEY).account();
    assert.deepEqual(a.escrow, { spendable_usd: "1.5", deposited_usd: "2", debt_usd: "0" });
    assert.deepEqual(a.recent_jobs, [{ status: "completed", cost_usd: 0.01, at: "2026-11-16T00:00:00Z" }]);
    assert.match(a.top_up, /Deposit/);
  } finally {
    api.restore();
  }
});

test("key mode sends the auto-routed ask to the account's /engine/ask, with the key and no budget of its own", async () => {
  const reply = { result: { result: { price_usd: 61744 }, intent: "CRYPTO_PRICE_USD", miner_id: "377", miner_name: "Kraken", cost_usd: 0.01, fulfillment: { status: "complete" } }, receipt: { receipt_hash: "0xabc", rail: "escrow" } };
  const api = fakeApi([[200, reply]]);
  try {
    const r = await new AnjomanApi("http://api.test", KEY).askAuto({ query: "BTC price" });
    assert.deepEqual(api.calls[0], { url: "http://api.test/engine/ask", method: "POST", auth: `Bearer ${KEY}`, body: { query: "BTC price" } });
    const out = JSON.parse(keyEngineAnswer(r).content[0].text);
    assert.deepEqual(out.answer, { price_usd: 61744 });
    assert.equal(out.miner, "Kraken (id 377)");
    assert.equal(out.cost_usd, 0.01);
    assert.equal(out.fulfillment.status, "complete");
    assert.deepEqual(out.receipt, { receipt_hash: "0xabc", rail: "escrow" });
    assert.equal(keyEngineAnswer(r).isError, undefined);
  } finally {
    api.restore();
  }
});

test("key mode sends a miner call to the account's /engine/ask/{miner}: a question, or the miner's own endpoint", async () => {
  const api = fakeApi([[200, { result: { result: "ok" }, receipt: null }], [200, { result: { result: "raw" }, receipt: null }]]);
  try {
    const key = new AnjomanApi("http://api.test", KEY);
    await key.askMiner("377", { query: "BTC price" });
    await key.askMiner("a b", { method: "GET", endpoint: "/price", payload: { s: "BTC" } });
    assert.deepEqual(api.calls.map((c) => [c.url, c.body]), [
      ["http://api.test/engine/ask/377", { query: "BTC price" }],
      ["http://api.test/engine/ask/a%20b", { method: "GET", endpoint: "/price", payload: { s: "BTC" } }],
    ]);
  } finally {
    api.restore();
  }
});

test("key mode passes the API's reason on when it refuses an ask", async () => {
  const api = fakeApi([[400, { message: "Insufficient escrow balance: you have $0.00 effective, this call costs $0.26.", statusCode: 400 }]]);
  try {
    await assert.rejects(new AnjomanApi("http://api.test", KEY).askAuto({ query: "hi" }), /400 from \/engine\/ask: Insufficient escrow balance/);
  } finally {
    api.restore();
  }
});

test("a turn that ended without an answer is an error for the agent, and one that answered is not", () => {
  assert.equal(keyAnswer({ status: "cancelled" }).isError, true);
  assert.equal(keyAnswer({ status: "running", jobId: "j1", note: "still going" }).isError, true);
  assert.equal(keyAnswer({ status: "failed", answer: "I couldn't get that: the account has no balance." }).isError, undefined);
});

test("the default network is the new testnet diamond, and asks carry a budget of 260000 μUSDC", () => {
  const c = loadConfig({ TELEGRAPH_HOME: home() });
  assert.equal(c.diamond, "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b");
  assert.equal(c.maxBudgetUsdc, 260000);
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_MAX_BUDGET_USDC: "60000" }).maxBudgetUsdc, 60000);
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_MAX_BUDGET_USDC: "0" }).maxBudgetUsdc, 0);
  assert.throws(() => loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_MAX_BUDGET_USDC: "0.26" }), /whole number/);
  assert.throws(() => loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_MAX_BUDGET_USDC: "-1" }));
});

test("a routed ask sends max_budget_usdc, capped by the per-ask limit, and none when it is 0", () => {
  const q = { query: "BTC price" };
  assert.deepEqual(routedAskBody({ maxBudgetUsdc: 260000, maxAskUsd: 0.5 }, q), { query: "BTC price", max_budget_usdc: 260000 });
  assert.equal(routedAskBody({ maxBudgetUsdc: 260000, maxAskUsd: 0.05 }, q).max_budget_usdc, 50000, "never above TELEGRAPH_MAX_ASK_USD");
  assert.equal(routedAskBody({ maxBudgetUsdc: 260000, maxAskUsd: 0 }, q).max_budget_usdc, 260000, "0 means no per-ask limit");
  assert.deepEqual(routedAskBody({ maxBudgetUsdc: 0, maxAskUsd: 0.5 }, q), q, "0: a single-miner ask");
  assert.deepEqual(routedAskBody({ maxBudgetUsdc: 260000, maxAskUsd: 0.005 }, q), q, "under one call: none, so the limit refuses the ask");
});

test("what an ask was billed: its payment rows, else the receipt, never above what was paid", () => {
  const payments = [{ amount_uusdc: 10000 }, { amount_uusdc: "20000" }];
  assert.equal(billedOf({ fulfillment: { payments } }, { amount_uusdc: "10000" }, 0.26), 0.03);
  assert.equal(billedOf({}, { amount_uusdc: "10000" }, 0.26), 0.01);
  assert.equal(billedOf({}, undefined, 0.26), 0.26, "unknown: counted in full");
  assert.equal(billedOf({ fulfillment: { payments: [{ amount_uusdc: 900000 }] } }, undefined, 0.26), 0.26);
});

test("an escrow ask signs for the budget the node quotes and counts only what was billed", async () => {
  const h = home();
  const cfg = loadConfig({ TELEGRAPH_HOME: h, TELEGRAPH_PRIVATE_KEY: newKey(), TELEGRAPH_URL: "http://node.test" });
  const diamond = "0x72a70e949362670bf8bcead24efc5b8f950aa08b";
  const challenge = {
    x402Version: 2,
    error: "Payment required",
    resource: { url: "http://node.test/engine/v1/ask", description: "ask", mimeType: "application/json" },
    accepts: [{
      scheme: "escrow", network: "eip155:11155111", amount: "260000", payTo: diamond,
      extra: { message: "Telegraph Escrow Payment\n\nWallet: {from}\nPay To: " + diamond + "\nNetwork: eip155:11155111\nAmount: 260000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}" },
    }],
  };
  const receipt = { receipt_hash: "0x01", rail: "escrow", amount_uusdc: "10000" };
  const reply = {
    result: { price_usd: 1 }, intent: "CRYPTO_PRICE_USD",
    fulfillment: { status: "complete", stopped: "complete", payments: [
      { miner: "1", intent: "CRYPTO_PRICE_USD", amount_uusdc: 10000, receipt_hash: "0x01" },
      { miner: "2", intent: "CRYPTO_VOLUME_USD", amount_uusdc: 10000, receipt_hash: "0x02" },
    ] },
  };
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body), payment: init.headers["X-PAYMENT"] });
    if (sent.length === 1) {
      return new Response(JSON.stringify({ error: "payment required" }), {
        status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge)).toString("base64") },
      });
    }
    return new Response(JSON.stringify(reply), {
      status: 200, headers: { "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") },
    });
  };
  try {
    const body = routedAskBody(cfg, { query: "BTC price and volume" });
    const r = await new Payer(cfg, cfg.privateKey).post("/engine/v1/ask", body);
    assert.equal(sent[0].body.max_budget_usdc, 260000, "the budget goes with the ask");
    const envelope = JSON.parse(Buffer.from(sent[1].payment, "base64").toString());
    assert.equal(envelope.scheme, "escrow");
    assert.equal(envelope.payload.authorization.value, "260000", "signed for the quoted budget");
    assert.equal(envelope.payload.authorization.to, diamond);
    assert.equal(r.status, 200);
    assert.equal(r.priceUsd, 0.26);
    assert.equal(r.billedUsd, 0.02, "two rows billed");
    assert.equal(new SpendLog(h).today(), 0.02, "the daily limit counts the rows, not the hold");
  } finally {
    globalThis.fetch = original;
  }
});
