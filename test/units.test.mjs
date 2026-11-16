import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";
import { saveWallet, readWalletKey, newKey, walletPath, walletUnreadable } from "../dist/wallet.js";
import { Dedupe, SpendLog, requestKey } from "../dist/limits.js";
import { AnjomanApi } from "../dist/api.js";
import { keyAnswer } from "../dist/tools.js";

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

const KEY = "tgk_" + "a".repeat(43);

test("an API key switches to key mode, is checked, and points at the Anjoman API by default", () => {
  const c = loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: ` ${KEY} ` });
  assert.equal(c.apiKey, KEY);
  assert.equal(c.apiUrl, "https://backend.telegraphprotocol.com");
  assert.equal(loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: KEY, TELEGRAPH_API_URL: "http://localhost:4100/" }).apiUrl, "http://localhost:4100");
  assert.equal(loadConfig({ TELEGRAPH_HOME: home() }).apiKey, undefined, "wallet mode without one");
  assert.throws(() => loadConfig({ TELEGRAPH_HOME: home(), TELEGRAPH_API_KEY: "0x" + "1".repeat(64) }), /starts with tgk_/);
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

test("a turn that ended without an answer is an error for the agent, and one that answered is not", () => {
  assert.equal(keyAnswer({ status: "cancelled" }).isError, true);
  assert.equal(keyAnswer({ status: "running", jobId: "j1", note: "still going" }).isError, true);
  assert.equal(keyAnswer({ status: "failed", answer: "I couldn't get that: the account has no balance." }).isError, undefined);
});
