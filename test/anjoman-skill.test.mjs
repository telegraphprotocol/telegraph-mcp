import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const SCRIPT = new URL("../skills/anjoman/scripts/anjoman.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CONV = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

// A stand-in for the backend: it records what it was sent and plays whatever scenario the test sets.
let server;
let base;
const seen = [];
let scenario = "complete";

const sse = (res, frames) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [event, data] of frames) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const step = (over = {}) => ({
  intent: "CRYPTO_PRICE_USD",
  status: "answered",
  miner: { slug: "txlens", id: "9", name: "TxLens", rank: 2 },
  durationMs: 1400,
  receipt: { receiptHash: "0xabc123" },
  attempts: [],
  ...over,
});

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
      if (req.headers.authorization !== "Bearer anjoman_test_key") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Invalid API key" }));
      }
      if (req.url === "/agent/chat") {
        if (scenario === "empty-balance") {
          res.writeHead(402, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ message: "Your balance is $0.00" }));
        }
        const head = [["conversation", { conversationId: CONV }], ["job", { jobId: JOB }], ["status", { stage: "classifying", message: "Planning the request" }], ["status", { stage: "asking_miner", message: "Asking TxLens", miner: "txlens" }]];
        if (scenario === "discarded" || scenario === "no-record") {
          // The turn failed: the stream ends without `done` or `error`, and (for "discarded") the job is gone with the conversation.
          sse(res, head);
          return res.end();
        }
        if (scenario === "dropped") {
          // The connection ends after the job id, before any `done`.
          sse(res, head);
          return res.end();
        }
        const steps = scenario === "partial" ? [step(), step({ intent: "WEATHER_NOW", status: "failed", reason: "provider_unavailable", miner: undefined, receipt: undefined })] : [step()];
        sse(res, [...head, ["trace", { steps }], ["done", { messageId: "m1", answer: scenario === "partial" ? "BTC is $97,000. Weather could not be read." : "BTC is $97,000.", status: scenario === "partial" ? "partial" : "complete", files: [], sources: [{ intent: "CRYPTO_PRICE_USD", question: "q", kind: "miner", miner: { slug: "txlens", name: "TxLens", rank: 2 }, receiptHash: "0xabc123" }], timings: { totalMs: 2000, byCategory: {} } }]]);
        return res.end();
      }
      if (req.url === `/agent/jobs/${JOB}` && scenario === "answer-without-job") {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "boom" }));
      }
      if (req.url === `/agent/jobs/${JOB}` && scenario === "discarded") {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Job not found." }));
      }
      if (req.url === `/agent/jobs/${JOB}`) {
        res.writeHead(200, { "Content-Type": "application/json" });
        const state = scenario === "cap" ? { id: JOB, status: "waiting_authorization", outcome: "failed", reason: "spend_limit_reached", costUsd: 0.5 } : scenario === "dropped" ? { id: JOB, status: "completed", outcome: "complete", answer: "Finished while you were away.", costUsd: 0.02, conversationId: CONV } : { id: JOB, status: "completed", outcome: "complete", costUsd: 0.0123 };
        return res.end(JSON.stringify(state));
      }
      if (req.url.startsWith("/engine/escrow/balance")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ effectiveBalance: "4.25", escrowBalance: "5", agentDebt: "0" }));
      }
      if (req.url === "/agent/spend/limit") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ limitUsd: 0.5 }));
      }
      if (req.url.startsWith("/agent/spend")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ totals: { jobs: 2 }, jobs: [{ status: "completed", costUsd: 0.01, startedAt: "2026-11-19T10:00:00Z" }] }));
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const home = () => mkdtempSync(join(tmpdir(), "anjoman-skill-"));

function run(args, env = {}, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ANJOMAN_API_URL: base, ANJOMAN_HOME: home(), ANJOMAN_API_KEY: "anjoman_test_key", ANJOMAN_MAX_SPEND_USD: "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const lastChat = () => seen.findLast((r) => r.url === "/agent/chat");

test("asks Anjoman with the key and no spend cap by default, and reports the answer, steps, receipt and cost", async () => {
  scenario = "complete";
  const r = await run(["ask", "What is the BTC price in USD?"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^BTC is \$97,000\./);
  assert.match(r.stdout, /Status: complete/);
  assert.match(r.stdout, /Cost: \$0\.0123/);
  assert.match(r.stdout, new RegExp(`Conversation: ${CONV}`));
  assert.match(r.stdout, /1\. CRYPTO_PRICE_USD → TxLens \(rank 2\): answered · 1\.4s/);
  assert.match(r.stdout, /Receipts:\n  CRYPTO_PRICE_USD: 0xabc123/);
  assert.match(r.stdout, /Sources:\n  CRYPTO_PRICE_USD — TxLens \[receipt 0xabc123\]/);
  // Progress is on stderr so the answer stays clean on stdout.
  assert.match(r.stderr, /Planning the request/);
  assert.match(r.stderr, /Asking TxLens/);
  // No spending cap unless the user sets one: the account's balance is the limit.
  assert.deepEqual(lastChat().body, { message: "What is the BTC price in USD?" });
  assert.equal(lastChat().auth, "Bearer anjoman_test_key");
});

test("a follow-up carries the conversation id, and the cap can be changed or removed", async () => {
  scenario = "complete";
  await run(["ask", "and in euros?", "--conversation", CONV, "--max-spend", "2"]);
  assert.deepEqual(lastChat().body, { message: "and in euros?", conversationId: CONV, maxSpendUsd: 2 });
  await run(["ask", "x", "--max-spend", "none"]);
  assert.equal("maxSpendUsd" in lastChat().body, false);
  await run(["ask", "x"], { ANJOMAN_MAX_SPEND_USD: "0.25" });
  assert.equal(lastChat().body.maxSpendUsd, 0.25);
  const bad = await run(["ask", "x", "--max-spend", "lots"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /positive number/);
});

test("a partial answer is flagged, with the step that failed and why", async () => {
  scenario = "partial";
  const r = await run(["ask", "BTC price and the weather"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Status: PARTIAL/);
  assert.match(r.stdout, /2\. WEATHER_NOW → no miner: failed · 1\.4s · reason: provider_unavailable/);
  assert.match(r.stdout, /Do not present the answer as complete/);
});

test("a request that hit the spend cap exits 3 and tells the agent to ask the user", async () => {
  scenario = "cap";
  const r = await run(["ask", "a big job"]);
  assert.equal(r.code, 3);
  assert.match(r.stdout, /Status: STOPPED/);
  assert.match(r.stdout, /ask whether to continue/);
  // A limit set in Anjoman is raised there, not from the command line.
  assert.match(r.stdout, /can only be raised there/);
  assert.match(r.stdout, /--max-spend can only lower it/);
});

test("a dropped connection is followed by its job instead of being lost", async () => {
  scenario = "dropped";
  const r = await run(["ask", "a long one", "--wait", "1"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Finished while you were away\./);
  assert.match(r.stdout, /Cost: \$0\.02/);
  assert.match(r.stderr, /connection lost|following the job/);
});

test("a failed first message, whose job was discarded with its conversation, is reported plainly", async () => {
  scenario = "discarded";
  const r = await run(["ask", "x", "--wait", "1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /ended the request without an answer and has no record of the job/);
  assert.match(r.stderr, /nothing is charged/i);
  assert.doesNotMatch(r.stderr, /404 from/);
});

test("an answer already received is kept even when the job's record cannot be read", async () => {
  scenario = "complete";
  // Same as "complete" but the job read fails: the answer must still be printed, with the cost unknown.
  const before = seen.length;
  scenario = "answer-without-job";
  const r = await run(["ask", "x"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^BTC is \$97,000\./);
  assert.match(r.stdout, /Cost: unknown/);
  assert.ok(seen.length > before);
});

test("--json prints the whole result as one object", async () => {
  scenario = "complete";
  const r = await run(["ask", "x", "--json"]);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, "complete");
  assert.equal(out.costUsd, 0.0123);
  assert.equal(out.conversationId, CONV);
  assert.equal(out.steps[0].receipt, "0xabc123");
  assert.equal(r.stderr, "");
});

test("a rejected key, or an empty balance, says what to do and exits 1", async () => {
  scenario = "complete";
  const wrong = await run(["ask", "x"], { ANJOMAN_API_KEY: "anjoman_wrong" });
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /401 from \/agent\/chat: Invalid API key/);
  assert.match(wrong.stderr, /rejected/);
  scenario = "empty-balance";
  const poor = await run(["ask", "x"]);
  assert.equal(poor.code, 1);
  assert.match(poor.stderr, /\$0\.00/);
  assert.match(poor.stderr, /add funds/i);
});

test("with no key it explains how to get one and never calls the API", async () => {
  const before = seen.length;
  const r = await run(["ask", "x"], { ANJOMAN_API_KEY: "", TELEGRAPH_API_KEY: "" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No Anjoman API key/);
  assert.match(r.stderr, /dashboard\/api-keys/);
  assert.equal(seen.length, before);
});

test("login stores the key privately and later requests use it; the key is never printed", async () => {
  const dir = home();
  const login = await run(["login"], { ANJOMAN_HOME: dir, ANJOMAN_API_KEY: "" }, "anjoman_test_key\n");
  assert.equal(login.code, 0);
  assert.equal(readFileSync(join(dir, "key"), "utf8").trim(), "anjoman_test_key");
  assert.doesNotMatch(login.stdout + login.stderr, /anjoman_test_key/);
  scenario = "complete";
  const r = await run(["ask", "x"], { ANJOMAN_HOME: dir, ANJOMAN_API_KEY: "" });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout + r.stderr, /anjoman_test_key/);
});

test("balance shows what is spendable, and cancel and job reach the job endpoints", async () => {
  const b = await run(["balance"]);
  assert.match(b.stdout, /Spendable: \$4\.25/);
  assert.match(b.stdout, /Spend limit per message: \$0\.50 \(set by the user in Anjoman\)/);
  scenario = "complete";
  const j = await run(["job", JOB]);
  assert.match(j.stdout, /State: completed/);
});

test("the copy under .agents/skills is identical to skills/, so the two cannot drift", () => {
  for (const file of ["SKILL.md", "scripts/anjoman.mjs"]) {
    const a = readFileSync(new URL(`../skills/anjoman/${file}`, import.meta.url), "utf8");
    const b = readFileSync(new URL(`../.agents/skills/anjoman/${file}`, import.meta.url), "utf8");
    assert.equal(b, a, `${file} differs between skills/anjoman and .agents/skills/anjoman`);
  }
});

test("the always-on rule is marked so it can be found and removed, and the skill file is well formed", async () => {
  const r = await run(["rule"]);
  assert.match(r.stdout, /<!-- anjoman:start -->[\s\S]*<!-- anjoman:end -->/);
  // A Windows checkout may have CRLF line endings; the file in git is LF.
  const skill = readFileSync(new URL("../skills/anjoman/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const front = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? "";
  assert.match(front, /^name: anjoman$/m);
  const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
  assert.ok(description.length > 100 && description.length <= 1024, `description is ${description.length} characters`);
});
