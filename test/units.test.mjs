import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";
import { saveWallet, readWalletKey, newKey, walletPath, walletUnreadable } from "../dist/wallet.js";
import { Dedupe, SpendLog, requestKey } from "../dist/limits.js";

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
