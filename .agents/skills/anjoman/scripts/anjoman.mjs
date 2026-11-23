#!/usr/bin/env node
// Anjoman skill client. One file, no dependencies, Node 18+.
//
// Sends a request to Anjoman's agent (POST /agent/chat) with the user's API key and prints the result for an AI agent
// to read: the answer, what it cost, which sources answered with their receipts, and the conversation id for a follow-up.
// Anjoman does the planning, the choice of miners, the combining and the recovery; this file only carries the request.
//
//   node anjoman.mjs ask "What is the BTC price?" [--conversation <id>] [--max-spend <usd>] [--pay <how>] [--json] [--quiet]
//   node anjoman.mjs auto "BTC price" [--intent X --params JSON] [--pay <how>] [--json]   auto-routed ask: the node picks the miner
//   node anjoman.mjs miner <id|slug> ["question"] [--intent X --params JSON | --endpoint /p --method GET --payload JSON] [--pay <how>]
//                                              miner call: one named miner, no routing
//   --pay escrow|solana|evm                    how the account pays (default escrow, or ANJOMAN_PAY)
//   node anjoman.mjs job <jobId> [--wait]      read a request that is still running, or ended
//   node anjoman.mjs cancel <jobId>            stop a request that is still running
//   node anjoman.mjs balance                   the account's escrow balance and recent spend
//   node anjoman.mjs login                     save the API key (read from the terminal or standard input)
//   node anjoman.mjs rule                      print the short always-on rule for an agent's instruction file

import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const DEFAULT_URL = "https://backend.telegraphprotocol.com";
/** The Telegraph node, read only to find a miner's id from its slug for a miner call. */
const DEFAULT_NODE_URL = "https://devnode.telegraphprotocol.com";
/** An auto-routed ask or a miner call answers in one reply: the node's own deadline is 60 seconds, plus payment. */
const ENGINE_WAIT_MS = 120_000;
/**
 * The user sets their spending limit in Anjoman, on their account, and the backend applies it to every request from the
 * account, whatever is sent here. This script adds no cap of its own unless --max-spend or ANJOMAN_MAX_SPEND_USD asks for
 * a lower one for a session; with neither set, the account's limit (or, with none, its balance) is all that applies.
 * When a cap applies, the backend stops the job at that amount and asks for approval. It holds back each call's quoted
 * ceiling (about $0.26) from the cap while the call runs and gives back what the call did not cost, so a request that asks
 * several specialists at once needs a cap with room for each, well above what such a request really costs.
 */
const DEFAULT_MAX_SPEND_USD = undefined;
/** How long a request that outlives its connection is followed before handing back its job id. */
const DEFAULT_WAIT_MINUTES = 15;
const POLL_MS = 3_000;
const CLOSE_OUT_MS = 10_000;
const EXIT = { ok: 0, error: 1, usage: 2, needsApproval: 3 };

const env = process.env;
const apiUrl = () => (env.ANJOMAN_API_URL || env.TELEGRAPH_API_URL || DEFAULT_URL).replace(/\/$/, "");
const nodeUrl = () => (env.ANJOMAN_NODE_URL || env.TELEGRAPH_URL || DEFAULT_NODE_URL).replace(/\/$/, "");
const homeDir = () => env.ANJOMAN_HOME || join(homedir(), ".anjoman");
const keyFile = () => join(homeDir(), "key");

class Fail extends Error {
  constructor(message, code = EXIT.error) {
    super(message);
    this.code = code;
  }
}

// ─── The key ────────────────────────────────────────────────────────────────────────────────────

function readKey() {
  const fromEnv = (env.ANJOMAN_API_KEY || env.TELEGRAPH_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    if (existsSync(keyFile())) return readFileSync(keyFile(), "utf8").trim();
  } catch {
    // Unreadable: treated as no key, with the same instructions.
  }
  return "";
}

function requireKey() {
  const key = readKey();
  if (!key) {
    throw new Fail(
      "No Anjoman API key. Ask the user to create one at https://anjoman.ai/dashboard/api-keys, then either set ANJOMAN_API_KEY or run:\n" +
        "  node anjoman.mjs login\n" +
        "Never ask for the key in chat and never print it.",
    );
  }
  return key;
}

/** Reads the key without echoing it when typed, or from standard input when piped. */
async function readSecret() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const write = rl._writeToOutput;
  rl._writeToOutput = (s) => (s.includes("\n") || s.includes("\r") ? write.call(rl, s) : undefined);
  process.stderr.write("Anjoman API key: ");
  const answer = await new Promise((resolve) => rl.question("", resolve));
  rl.close();
  process.stderr.write("\n");
  return String(answer).trim();
}

async function login() {
  const key = await readSecret();
  if (!key) throw new Fail("No key was given.", EXIT.usage);
  mkdirSync(homeDir(), { recursive: true, mode: 0o700 });
  writeFileSync(keyFile(), `${key}\n`, { mode: 0o600 });
  try {
    chmodSync(keyFile(), 0o600);
  } catch {
    // Windows has no file modes; the file is still in the user's own profile.
  }
  console.log(`Saved the key to ${keyFile()} (readable only by you).`);
}

// ─── Talking to the API ─────────────────────────────────────────────────────────────────────────

/** What the user should do about a refused request, in the words of the status. */
function hintFor(status) {
  if (status === 401) return "The API key was rejected: it may be wrong, expired or revoked. Ask the user to check or create a key at https://anjoman.ai/dashboard/api-keys.";
  if (status === 402) return "The account cannot pay for this. Ask the user to add funds in Anjoman (Deposit in the wallet menu).";
  if (status === 403) return "This key is not allowed to do that.";
  if (status === 429) return "Too many requests (a key makes up to 30 a minute). Wait a minute and try again.";
  return "";
}

async function failureOf(res, path) {
  const text = await res.text().catch(() => "");
  let message = "";
  try {
    const body = JSON.parse(text);
    message = Array.isArray(body.message) ? body.message.join(", ") : body.message || body.error || "";
  } catch {
    message = text.slice(0, 300);
  }
  const hint = hintFor(res.status);
  return new Fail(`${res.status} from ${path}: ${message || "no message"}${hint ? `\n${hint}` : ""}`);
}

async function api(method, path, body, { signal } = {}) {
  const key = requireKey();
  let res;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Fail(`Could not reach Anjoman at ${apiUrl()}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw await failureOf(res, path);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** Server-sent events as { event, data } objects, as they arrive. */
async function* events(res) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length === 0) continue;
      try {
        yield { event, data: JSON.parse(data.join("\n")) };
      } catch {
        // A frame that is not JSON carries nothing we use.
      }
    }
  }
}

// ─── ask ────────────────────────────────────────────────────────────────────────────────────────

function parseFlags(args, spec) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in spec)) throw new Fail(`Unknown option --${name}.`, EXIT.usage);
    if (spec[name] === "boolean") flags[name] = true;
    else {
      const value = args[++i];
      if (value === undefined) throw new Fail(`--${name} needs a value.`, EXIT.usage);
      flags[name] = value;
    }
  }
  return { flags, rest };
}

const PAYMENTS = ["escrow", "solana", "evm"];

/**
 * The body fields that choose how the account pays: escrow (its escrow balance, the default, so no fields), or x402 from
 * its Solana address (every account has one) or its EVM address (wallet-connected accounts only).
 */
function paymentFields(flag) {
  const pay = String(flag ?? env.ANJOMAN_PAY ?? "escrow").trim().toLowerCase();
  if (!PAYMENTS.includes(pay)) throw new Fail(`--pay must be escrow, solana or evm: got "${pay}".`, EXIT.usage);
  return pay === "escrow" ? {} : { paymentMethod: "x402", network: pay };
}

function spendCap(flag) {
  const raw = flag ?? env.ANJOMAN_MAX_SPEND_USD;
  if (raw === undefined || raw === "") return DEFAULT_MAX_SPEND_USD;
  if (raw === "0" || raw === "none" || raw === "off") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Fail(`The spend cap must be a positive number of dollars, or "none": got "${raw}".`, EXIT.usage);
  return Math.round(n * 1e6) / 1e6;
}

/** Dollars to the cent, with more digits only where a small amount needs them: $0.50, $0.0123. */
const usd = (n) => (typeof n === "number" ? `$${n.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, "$1")}` : "unknown");
const seconds = (ms) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "");

async function readMessage(words) {
  if (words.length === 1 && words[0] === "-") {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return words.join(" ").trim();
}

async function ask(args) {
  const { flags, rest } = parseFlags(args, { conversation: "value", "max-spend": "value", pay: "value", json: "boolean", quiet: "boolean", wait: "value" });
  const message = await readMessage(rest);
  if (!message) throw new Fail('Give the request, e.g. node anjoman.mjs ask "What is the BTC price in USD?"', EXIT.usage);
  const maxSpendUsd = spendCap(flags["max-spend"]);
  const payment = paymentFields(flags.pay);
  const waitMs = Number(flags.wait ?? DEFAULT_WAIT_MINUTES) * 60_000;
  const progress = (text) => {
    if (!flags.quiet && !flags.json) process.stderr.write(`… ${text}\n`);
  };

  const run = { conversationId: flags.conversation, jobId: undefined, steps: [], done: undefined, error: undefined };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  try {
    const key = requireKey();
    let res;
    try {
      res = await fetch(`${apiUrl()}/agent/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
        body: JSON.stringify({ message, ...(flags.conversation && { conversationId: flags.conversation }), ...(maxSpendUsd !== undefined && { maxSpendUsd }), ...payment }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Fail(`Could not reach Anjoman at ${apiUrl()}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw await failureOf(res, "/agent/chat");

    try {
      for await (const { event, data } of events(res)) {
        if (event === "conversation") run.conversationId = data.conversationId;
        else if (event === "job") run.jobId = data.jobId;
        else if (event === "status") progress(data.message || data.stage);
        else if (event === "trace") run.steps = data.steps || [];
        else if (event === "done") run.done = data;
        else if (event === "error") run.error = data.message || "The request failed.";
      }
    } catch (err) {
      // The connection dropped. The request keeps running on Anjoman's side, so it is followed by its job below.
      if (!run.jobId) throw new Fail(`The connection to Anjoman was lost before the request started: ${err instanceof Error ? err.message : String(err)}`);
      progress("connection lost; following the job");
    }

    if (!run.done && !run.error && run.jobId) progress("the stream ended early; following the job");

    // The job holds the cost and the final state. One that ended without its `done` event (a dropped connection, a long
    // job) is followed until it ends; one that just finished gets a few seconds to be closed out, so its cost is there.
    let job;
    if (run.jobId) {
      try {
        job = await followJob(run.jobId, run.done || run.error ? CLOSE_OUT_MS : waitMs, progress);
      } catch (err) {
        // An answer already received is never thrown away because the job's record could not be read.
        if (run.done) progress(`could not read the job's final state (${err instanceof Error ? err.message : String(err)})`);
        else if (run.error) progress("could not read the job's final state");
        else if (err instanceof Fail && /^404 /.test(err.message)) {
          throw new Fail(
            "Anjoman ended the request without an answer and has no record of the job. A first message that fails is discarded, and nothing is charged. Try the request again; if it keeps failing, tell the user.",
          );
        } else throw err;
      }
    } else if (!run.done && !run.error) {
      throw new Fail("Anjoman closed the connection without an answer. Nothing is known to have been charged. Try the request again.");
    }
    const result = summarise(run, job);
    print(result, flags.json);
    process.exitCode = result.status === "waiting_authorization" ? EXIT.needsApproval : result.failed ? EXIT.error : EXIT.ok;
  } finally {
    clearTimeout(timer);
  }
}

/** The job's state: once it has ended, or when `waitMs` runs out. */
async function followJob(jobId, waitMs, progress) {
  const until = Date.now() + waitMs;
  for (;;) {
    const job = await api("GET", `/agent/jobs/${encodeURIComponent(jobId)}`);
    if (job.status !== "running" || Date.now() >= until) return job;
    progress("still working");
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(250, until - Date.now()))));
  }
}

function stepLine(s, i) {
  const who = s.miner ? `${s.miner.name || s.miner.slug}${s.routedBy === "node" || !s.miner.rank ? "" : ` (rank ${s.miner.rank})`}` : s.status === "answered" ? "knowledge base" : "no miner";
  const parts = [`${i + 1}. ${s.intent} → ${who}: ${s.status}`];
  if (s.durationMs) parts.push(seconds(s.durationMs));
  if (s.delivery && s.delivery !== "specialist") parts.push(`fallback: ${s.delivery.replace(/_/g, " ")}`);
  if (s.missing) parts.push(`missing: ${s.missing}`);
  if (s.status !== "answered" && s.reason) parts.push(`reason: ${s.reason}`);
  if (s.needsInput?.length) parts.push(`needs from the user: ${s.needsInput.join(", ")}`);
  return parts.join(" · ");
}

function receiptOf(s) {
  const r = s.receipt;
  if (!r) return undefined;
  if (typeof r === "string") return r;
  const id = r.receiptHash ?? r.receipt_hash ?? r.hash ?? r.txHash ?? r.id;
  return typeof id === "string" ? id : JSON.stringify(r).slice(0, 160);
}

/** Everything the caller needs, as one structure: the printed report and `--json` both come from it. */
function summarise(run, job) {
  const done = run.done;
  const answer = done?.answer ?? job?.answer ?? "";
  const status = job?.status === "waiting_authorization" ? "waiting_authorization" : (done?.status ?? job?.outcome ?? job?.status ?? "unknown");
  // A cap that stopped the job needs the user, not a retry; every other way of not answering is a failure.
  const failed = status !== "waiting_authorization" && (!answer || status === "failed" || job?.status === "failed" || Boolean(run.error));
  return {
    answer,
    status,
    jobStatus: job?.status,
    failed,
    error: run.error ?? (job?.status === "failed" ? job.error || job.reason || "The request failed." : undefined),
    reason: job?.reason,
    costUsd: job?.costUsd ?? null,
    conversationId: run.conversationId ?? job?.conversationId,
    jobId: run.jobId ?? job?.id,
    steps: run.steps.map((s) => ({
      intent: s.intent,
      status: s.status,
      miner: s.miner?.slug,
      routedBy: s.routedBy,
      delivery: s.delivery,
      missing: s.missing,
      reason: s.reason,
      durationMs: s.durationMs,
      receipt: receiptOf(s),
    })),
    stepLines: run.steps.map(stepLine),
    sources: done?.sources ?? [],
    files: done?.files ?? [],
    timings: done?.timings,
    stillRunning: job?.status === "running",
  };
}

function print(r, asJson) {
  if (asJson) {
    const { stepLines: _lines, ...out } = r;
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const out = [];
  if (r.answer) out.push(r.answer.trim(), "");
  if (r.stillRunning) out.push(`The request is still running. Read it later with: node anjoman.mjs job ${r.jobId} --wait`, "");
  if (r.error) out.push(`Error: ${r.error}`, "");
  out.push("— Anjoman —");
  const label = { complete: "complete", partial: "PARTIAL — only part of the request was answered", failed: "FAILED", unsupported: "UNSUPPORTED — the network has nothing for this", waiting_authorization: "STOPPED — it reached the spend cap and needs the user's approval" }[r.status] ?? r.status;
  out.push(`Status: ${label}`);
  out.push(`Cost: ${usd(r.costUsd)}`);
  if (r.conversationId) out.push(`Conversation: ${r.conversationId}  (pass --conversation ${r.conversationId} to continue it)`);
  if (r.jobId) out.push(`Job: ${r.jobId}`);
  if (r.stepLines.length) out.push("Steps:", ...r.stepLines.map((l) => `  ${l}`));
  const receipts = r.steps.filter((s) => s.receipt);
  if (receipts.length) out.push("Receipts:", ...receipts.map((s) => `  ${s.intent}: ${s.receipt}`));
  const named = r.sources.map((s) => `${s.intent}${s.miner ? ` — ${s.miner.name || s.miner.slug}` : s.kind === "docs" ? " — Telegraph docs" : ""}${s.delivery && s.delivery !== "specialist" ? ` (${s.delivery.replace(/_/g, " ")})` : ""}${s.receiptHash ? ` [receipt ${s.receiptHash}]` : ""}`);
  if (named.length) out.push("Sources:", ...named.map((l) => `  ${l}`));
  if (r.files.length) out.push("Files made (download in the Anjoman app):", ...r.files.map((f) => `  ${f.name} (${f.size} bytes)`));
  if (r.status === "waiting_authorization") out.push("", "It stopped at a spending limit. Tell the user what it stopped at and ask whether to continue. A limit the user set in Anjoman can only be raised there (the spend limit button in the chat, at anjoman.ai); --max-spend can only lower it. Never raise or remove a limit yourself.");
  if (r.status === "partial") out.push("", "Tell the user which parts are missing (see Steps). Do not present the answer as complete.");
  console.log(out.join("\n"));
}

// ─── auto, miner ────────────────────────────────────────────────────────────────────────────────
// Straight to the Telegraph node through the account, without Anjoman's agent: no planning and no written answer, just the
// miner's answer in the intent's fields. Paid by the account like `ask` (--pay). Paid on Solana, an auto-routed ask goes
// without the budget, so one miner answers.

function jsonObject(name, raw) {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // Reported below.
  }
  throw new Fail(`--${name} must be a JSON object, e.g. '{"symbol":"BTC"}'.`, EXIT.usage);
}

/** A question, an exact intent with its params, or both (the node reads the missing params from the question). */
function canonicalBody(question, flags) {
  const params = flags.params !== undefined ? jsonObject("params", flags.params) : undefined;
  const intent = flags.intent ? flags.intent.trim().toUpperCase() : undefined;
  if (params && !intent) throw new Fail("--params need --intent.", EXIT.usage);
  if (!question && !params) throw new Fail('Give a question, or --intent with --params, e.g. node anjoman.mjs auto "BTC price in USD"', EXIT.usage);
  return { ...(question && { query: question }), ...(intent && { intent }), ...(params && { params }) };
}

/** The node's miner call finds a miner by id, so a slug is looked up on the node first; unknown, it is sent as given. */
async function minerId(miner) {
  if (/^\d+$/.test(miner)) return miner;
  try {
    const res = await fetch(`${nodeUrl()}/engine/v1/miners`, { signal: AbortSignal.timeout(15_000) });
    const found = ((await res.json()).miners || []).find((m) => m.slug === miner);
    return found ? String(found.id) : miner;
  } catch {
    return miner;
  }
}

async function auto(args) {
  const { flags, rest } = parseFlags(args, { intent: "value", params: "value", pay: "value", json: "boolean" });
  const body = { ...canonicalBody(await readMessage(rest), flags), ...paymentFields(flags.pay) };
  printEngine(await api("POST", "/engine/ask", body, { signal: AbortSignal.timeout(ENGINE_WAIT_MS) }), "auto-routed ask", flags.json);
}

async function miner(args) {
  const { flags, rest } = parseFlags(args, { intent: "value", params: "value", endpoint: "value", method: "value", payload: "value", pay: "value", json: "boolean" });
  const [who, ...words] = rest;
  if (!who) throw new Fail('Give the miner, e.g. node anjoman.mjs miner crypto-kraken "BTC price"', EXIT.usage);
  const question = words.join(" ").trim();
  let body;
  if (flags.endpoint) {
    if (question || flags.intent || flags.params) throw new Fail("Send either a question (with --intent and --params), or --endpoint with --method and --payload, not both.", EXIT.usage);
    body = { method: (flags.method || "GET").toUpperCase(), endpoint: flags.endpoint, payload: flags.payload ? jsonObject("payload", flags.payload) : {} };
  } else {
    body = canonicalBody(question, flags);
  }
  const id = await minerId(who);
  body = { ...body, ...paymentFields(flags.pay) };
  printEngine(await api("POST", `/engine/ask/${encodeURIComponent(id)}`, body, { signal: AbortSignal.timeout(ENGINE_WAIT_MS) }), "miner call", flags.json);
}

function fieldLines(answer) {
  if (answer && typeof answer === "object" && !Array.isArray(answer)) {
    return Object.entries(answer).map(([k, v]) => `${k}: ${v !== null && typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  return [typeof answer === "string" ? answer : JSON.stringify(answer)];
}

/** The node's reply, as the account hands it back: `result` is the node's body and `receipt` the payment's. */
function printEngine(r, kind, asJson) {
  const b = r?.result && typeof r.result === "object" ? r.result : { result: r?.result };
  const f = b.fulfillment;
  const receipt = r?.receipt?.receipt_hash ?? r?.receipt?.receiptHash ?? f?.payments?.[0]?.receipt_hash;
  const out = {
    kind,
    answer: b.result,
    status: f?.status ?? "answered",
    intent: b.intent,
    miner: b.miner_name ? `${b.miner_name} (id ${b.miner_id})` : b.miner_id,
    costUsd: b.cost_usd ?? null,
    receipt,
    missing: f?.missing_ids,
    resultShape: b.result_shape,
    fieldStatus: b.field_status,
    payments: f?.payments,
    warnings: b.warnings,
  };
  if (asJson) return console.log(JSON.stringify(out, null, 2));
  const label = { complete: "complete", partial: "PARTIAL — only part of the request was answered", unverifiable: "UNVERIFIABLE — an answer exists but could not be checked", unavailable: "UNAVAILABLE — nothing usable came back" }[out.status] ?? out.status;
  const lines = [...fieldLines(out.answer), "", `— Anjoman · ${kind} —`, `Status: ${label}`];
  if (out.intent) lines.push(`Intent: ${out.intent}`);
  if (out.miner) lines.push(`Miner: ${out.miner}`);
  lines.push(`Cost: ${usd(out.costUsd)}`);
  if (out.receipt) lines.push(`Receipt: ${out.receipt}`);
  if (out.missing?.length) lines.push(`Missing: ${out.missing.join(", ")}`);
  if (out.warnings?.length) lines.push(`Warnings: ${out.warnings.join("; ")}`);
  if (out.status === "partial") lines.push("", "Tell the user which fields are missing. Do not present the answer as complete.");
  console.log(lines.join("\n"));
}

// ─── job, cancel, balance ───────────────────────────────────────────────────────────────────────

async function job(args) {
  const { flags, rest } = parseFlags(args, { wait: "boolean", json: "boolean" });
  const id = rest[0];
  if (!id) throw new Fail("Give the job id: node anjoman.mjs job <jobId> [--wait]", EXIT.usage);
  const state = flags.wait ? await followJob(id, DEFAULT_WAIT_MINUTES * 60_000, (t) => process.stderr.write(`… ${t}\n`)) : await api("GET", `/agent/jobs/${encodeURIComponent(id)}`);
  if (flags.json) return console.log(JSON.stringify(state, null, 2));
  if (state.answer) console.log(`${state.answer.trim()}\n`);
  console.log(["— Anjoman —", `Job: ${state.id ?? id}`, `State: ${state.status}${state.outcome ? ` (${state.outcome})` : ""}`, `Cost: ${usd(state.costUsd)}`, state.reason ? `Reason: ${state.reason}` : "", state.error ? `Error: ${state.error}` : "", state.conversationId ? `Conversation: ${state.conversationId}` : ""].filter(Boolean).join("\n"));
  if (state.status === "waiting_authorization") process.exitCode = EXIT.needsApproval;
}

async function cancel(args) {
  const id = args[0];
  if (!id) throw new Fail("Give the job id: node anjoman.mjs cancel <jobId>", EXIT.usage);
  const state = await api("POST", `/agent/jobs/${encodeURIComponent(id)}/cancel`, {});
  console.log(`Job ${id}: ${state.status}`);
}

async function balance() {
  // The per-message limit is read too, so an agent can tell what holds. An older backend without it just shows none.
  const [bal, spend, limit] = await Promise.all([
    api("GET", "/engine/escrow/balance"),
    api("GET", "/agent/spend?limit=5"),
    api("GET", "/agent/spend/limit").catch(() => ({})),
  ]);
  console.log(
    [
      "— Anjoman account —",
      `Spendable: ${usd(Number(bal.effectiveBalance))}`,
      `Spend limit per message: ${typeof limit.limitUsd === "number" ? usd(limit.limitUsd) : "none"} (set by the user in Anjoman)`,
      `In escrow: ${usd(Number(bal.escrowBalance))} (as of the last ledger root)`,
      Number(bal.unbilled) > 0 ? `Not yet charged: ${usd(Number(bal.unbilled))} (counted against Spendable)` : "",
      bal.withdrawal ? `Withdrawal requested: ${usd(Number(bal.withdrawal.amount))} (${bal.withdrawal.status}; counted against Spendable)` : "",
      Number(bal.agentDebt) > 0 ? `Owed: ${usd(Number(bal.agentDebt))}` : "",
      spend.totals ? `Spent so far: ${JSON.stringify(spend.totals)}` : "",
      ...(spend.jobs || []).map((j) => `  ${j.startedAt ?? ""} ${j.status} ${usd(j.costUsd)}`),
      "Top up in Anjoman (Deposit in the wallet menu). Calls with --pay solana are paid from the account's Solana address instead (same menu; free test USDC at https://faucet.circle.com). This script cannot move funds.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

// ─── The always-on rule ─────────────────────────────────────────────────────────────────────────

const RULE = `<!-- anjoman:start -->
## Anjoman for outside intelligence
When a task needs information or analysis from outside this conversation and the local project (live prices and market data, weather, news, web or academic research, security or compliance checks, wallet or contract risk, fact checks, or multi-source research), use the \`anjoman\` skill instead of searching the web or guessing. Send the user's request to Anjoman as it is; it decides which specialists to use. Continue a topic with the same conversation id. Report its status, cost and sources honestly, and never present a partial answer as complete. Do not use it for editing local code or files, or for anything answerable from the project itself.
<!-- anjoman:end -->`;

// ─── Entry ──────────────────────────────────────────────────────────────────────────────────────

const HELP = `Anjoman skill client

  node anjoman.mjs ask "<request>" [--conversation <id>] [--max-spend <usd|none>] [--pay <how>] [--wait <minutes>] [--json] [--quiet]
  node anjoman.mjs auto "<question>" [--intent <INTENT> --params '<json>'] [--pay <how>] [--json]
  node anjoman.mjs miner <id|slug> ["<question>"] [--intent <INTENT> --params '<json>'] [--pay <how>] [--json]
  node anjoman.mjs miner <id|slug> --endpoint </path> [--method GET|POST] [--payload '<json>'] [--pay <how>] [--json]
  node anjoman.mjs job <jobId> [--wait] [--json]
  node anjoman.mjs cancel <jobId>
  node anjoman.mjs balance
  node anjoman.mjs login
  node anjoman.mjs rule

The key is read from ANJOMAN_API_KEY, or from ${keyFile()} after \`login\`.
Your spending limit is set in Anjoman (the spend limit button in the chat) and applies to every request from your account;
--max-spend or ANJOMAN_MAX_SPEND_USD can only set a lower one. With no limit set, your balance is the limit.
auto (auto-routed ask) and miner (miner call) go straight to the Telegraph node, without the agent. An auto-routed ask holds
a budget of $0.26 while it runs and is billed only for the miners whose answers are used; a miner call costs that miner's price.
--pay (or ANJOMAN_PAY) chooses how your account pays: escrow (your escrow balance, the default), solana (x402 from your
account's Solana address) or evm (x402 from its EVM address, wallet-connected accounts only). Paid on Solana, an auto-routed
ask is answered by one miner, without filling in from the next ones.`;

export async function main(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case "ask":
      return ask(args);
    case "auto":
      return auto(args);
    case "miner":
      return miner(args);
    case "job":
      return job(args);
    case "cancel":
      return cancel(args);
    case "balance":
      return balance();
    case "login":
      return login();
    case "rule":
      return console.log(RULE);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return console.log(HELP);
    default:
      throw new Fail(`Unknown command "${command}".\n\n${HELP}`, EXIT.usage);
  }
}

// Resolve the launcher path: skill installers may link the script or its directory.
// Imports still do not run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Fail ? err.message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = err instanceof Fail ? err.code : EXIT.error;
  });
}

export { spendCap, summarise, parseFlags, events, stepLine, canonicalBody, paymentFields, RULE };
