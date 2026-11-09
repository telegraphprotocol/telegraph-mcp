// End-to-end on a LOCAL Telegraph stack (scripts/mainnet/node-demo.sh in the node repo):
// fresh setup -> wallet -> deposit -> tools -> paid asks -> receipts -> retries,
// failures, empty escrow, limits and restart. Free: anvil, no real network.
//   E2E_NODE=http://127.0.0.1:7244 E2E_RPC=http://127.0.0.1:8688 E2E_DIAMOND=0x... \
//   E2E_FUNDER_KEY=<anvil key with ETH> node scripts/e2e-local.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const NODE = process.env.E2E_NODE, RPC = process.env.E2E_RPC, DIAMOND = process.env.E2E_DIAMOND;
const FUNDER = process.env.E2E_FUNDER_KEY;
const MINER = process.env.E2E_MINER || "demo-weather";
const ask = (city) => ({ miner: MINER, endpoint: "/forecast", method: "GET", payload: { city } });
if (!NODE || !RPC || !DIAMOND || !FUNDER) throw new Error("set E2E_NODE, E2E_RPC, E2E_DIAMOND, E2E_FUNDER_KEY");

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const cast = (...a) => execFileSync("cast", [...a, "--rpc-url", RPC], { encoding: "utf8" }).trim();
const num = (s) => Number(String(s).split(" ")[0]);

const baseEnv = (home, extra = {}) => {
  const e = { ...process.env, TELEGRAPH_HOME: home, TELEGRAPH_URL: NODE, TELEGRAPH_RPC_URL: RPC, TELEGRAPH_DIAMOND: DIAMOND, TELEGRAPH_CHAIN_ID: "31337", ...extra };
  delete e.TELEGRAPH_PRIVATE_KEY;
  delete e.TELEGRAPH_EVM_PRIVATE_KEY;
  return e;
};
const cli = (home, args, extra) => spawnSync("node", ["dist/index.js", ...args], { env: baseEnv(home, extra), encoding: "utf8", input: "" });

async function connect(home, extra) {
  const t = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: baseEnv(home, extra), stderr: "pipe" });
  const c = new Client({ name: "e2e", version: "1" });
  await c.connect(t);
  return c;
}
const call = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content.map((x) => x.text).join("\n");
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { isError: !!r.isError, text, json };
};

// A brand-new wallet, funded the way a person would: ETH from a faucet, USDC sent to it.
function newWalletHome(usdc) {
  const home = mkdtempSync(join(tmpdir(), "tg-e2e-"));
  const s = cli(home, ["setup", "--yes", "--client", "none"]);
  const addr = JSON.parse(readFileSync(join(home, "wallet.json"), "utf8")).address;
  cast("send", "--private-key", FUNDER, addr, "--value", "0.05ether");
  if (usdc > 0) {
    const token = cast("call", DIAMOND, "usdcToken()(address)");
    cast("send", "--private-key", FUNDER, token, "mint(address,uint256)", addr, String(Math.round(usdc * 1e6)));
  }
  return { home, addr, setupOut: s.stdout };
}
const escrow = (addr) => num(cast("call", DIAMOND, "effectiveBalance(address)(uint256)", addr)) / 1e6;

// 1. Fresh setup, wallet, deposit.
const A = newWalletHome(3);
check("setup creates a private wallet with no key in its output", /Saved\. Address 0x/.test(A.setupOut) && !A.setupOut.includes(JSON.parse(readFileSync(join(A.home, "wallet.json"), "utf8")).privateKey.slice(2)));
const fund = cli(A.home, ["fund", "2", "--yes"]);
check("fund deposits after confirmation (approve + deposit)", fund.status === 0 && /Deposited/.test(fund.stdout), fund.stdout.split("\n").find((l) => l.startsWith("Deposited"))?.slice(0, 90));
const e0 = escrow(A.addr);
check("escrow shows the deposit on chain", e0 === 2, `${e0} USDC`);

// 2. The agent finds the tools; no money-moving tool.
let c = await connect(A.home);
const tools = (await c.listTools()).tools.map((t) => t.name);
check("agent sees 8 tools and no deposit tool", tools.length === 8 && !tools.includes("telegraph_deposit"), tools.join(","));
const acct = await call(c, "telegraph_account");
check("telegraph_account: address, network, escrow, limits", acct.json?.escrow?.spendable_usdc === 2 && acct.json?.limits?.daily_usd === 5, `escrow ${acct.json?.escrow?.spendable_usdc}`);

// 3. A paid ask: result and receipt from escrow.
const q1 = ask("Lahore");
const a1 = await call(c, "telegraph_ask_miner", q1);
check("paid ask returns an answer", !a1.isError && a1.json?.answer !== undefined, a1.isError ? a1.text.slice(0, 160) : `miner ${a1.json?.miner}`);
check("paid from escrow with a receipt", a1.json?.payment?.rail === "escrow" && !!a1.json?.payment?.receipt, `price $${a1.json?.payment?.price_usd}`);

// 4. A retry of the same ask is not paid again.
const a1b = await call(c, "telegraph_ask_miner", q1);
check("identical retry is answered without a second payment", !!a1b.json?.payment?.repeated);

// 5. A second, different paid ask with no further setup.
const a2 = await call(c, "telegraph_ask_miner", ask("Karachi"));
check("next ask needs no setup", !a2.isError && a2.json?.payment?.rail === "escrow");

// 6. A failed ask is not billed.
const spentBefore = (await call(c, "telegraph_account")).json?.limits?.spent_today_usd;
const bad = await call(c, "telegraph_ask", { question: "What is the AAPL stock price?", intent: "STOCK_PRICE_GENERAL" });
const spentAfter = (await call(c, "telegraph_account")).json?.limits?.spent_today_usd;
check("an ask no miner can serve fails cleanly and is not counted", bad.isError && spentAfter === spentBefore, bad.text.replace(/\s+/g, " ").slice(0, 120));
await c.close();

// 7. Restart: a new server process, nothing to set up again.
c = await connect(A.home);
const a3 = await call(c, "telegraph_ask_miner", ask("Islamabad"));
check("after a restart the next ask just works", !a3.isError && a3.json?.payment?.rail === "escrow");
await c.close();

// 8. Limits refuse before signing.
c = await connect(A.home, { TELEGRAPH_MAX_ASK_USD: "0.000001" });
const lim = await call(c, "telegraph_ask_miner", ask("Quetta"));
check("per-ask limit refuses and pays nothing", lim.isError && /limit per ask/.test(lim.text), lim.text.slice(0, 90));
await c.close();
const spent = (s) => Number(JSON.parse(cli(A.home, ["status"]).stdout).limits.spent_today_usd);
c = await connect(A.home, { TELEGRAPH_DAILY_LIMIT_USD: String(spent() + 0.000001) });
const day = await call(c, "telegraph_ask_miner", ask("Multan"));
check("daily limit refuses and pays nothing", day.isError && /daily limit/.test(day.text), day.text.slice(0, 90));
await c.close();

// 9. Empty escrow: a clear top-up message, and no payment from the wallet.
const B = newWalletHome(1); // 1 USDC in the wallet, nothing in escrow
const walletBefore = num(cast("call", cast("call", DIAMOND, "usdcToken()(address)"), "balanceOf(address)(uint256)", B.addr));
c = await connect(B.home);
const empty = await call(c, "telegraph_ask_miner", ask("Lahore"));
const walletAfter = num(cast("call", cast("call", DIAMOND, "usdcToken()(address)"), "balanceOf(address)(uint256)", B.addr));
check("empty escrow: refused with how to top up", empty.isError && /fund/.test(empty.text) && /escrow/.test(empty.text), empty.json?.error);
check("empty escrow: wallet USDC untouched (no x402 fallback)", walletBefore === walletAfter, `${walletBefore} -> ${walletAfter}`);
await c.close();

// 10. No wallet at all: the agent is told to run setup.
const C = mkdtempSync(join(tmpdir(), "tg-e2e-"));
c = await connect(C);
const none = await call(c, "telegraph_ask", { question: "BTC price" });
check("no wallet: the agent is told the one command to run", none.isError && /setup/.test(none.text));
await c.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
