import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, type Config } from "./config.js";
import { Chain } from "./chain.js";
import { SpendLog } from "./limits.js";
import { newKey, saveWallet, walletPath, walletUnreadable } from "./wallet.js";
import { getJson } from "./http.js";
import { RUN, SERVER } from "./tools.js";

// The terminal side, for a person: make a wallet, fund it, add the server to an
// agent app. Every on-chain step asks first. The MCP server never prompts and
// never handles setup.

const FAUCET = "https://anjoman.ai/dashboard/faucet"; // where beta 2's test USDC comes from
const GUIDE = "https://anjoman.ai/docs/using/mcp-server"; // setup for every other app

const HELP = `Telegraph MCP server

  ${RUN} setup          make a wallet, fund it, and add Telegraph to your agent
  ${RUN} fund [usd]     move USDC into escrow (you confirm first)
  ${RUN} withdraw [usd] take USDC back out: request it, then run it again to collect
  ${RUN} status         balances, limits and what today's asks have cost
  ${RUN} install [app]  add Telegraph to claude-desktop, cursor or claude-code (any other app: it links the setup guide)

With no command, an MCP client starts this as a server over stdio.`;

export async function runCli(argv: string[]): Promise<number> {
  const io = new Io(argv.includes("--yes") || argv.includes("-y"));
  const flag = (name: string) => argv[argv.indexOf(name) + 1];
  const word = () => argv.slice(1).find((a) => !a.startsWith("-"));
  // An amount that is not a number is a mistake worth saying out loud.
  const usd = () => {
    const raw = word();
    if (raw === undefined) return undefined;
    if (!(Number(raw) > 0)) throw new Error(`"${raw}" is not an amount. Try \`${RUN} ${argv[0]} 2\`.`);
    return Number(raw);
  };
  try {
    switch (argv[0]) {
      case "setup":
        return await setup(io, argv.includes("--client") ? flag("--client") : undefined);
      case "fund":
        return await fund(io, loadConfig(), usd());
      case "withdraw":
        return await withdraw(io, loadConfig(), usd());
      case "status":
        return await status(io, loadConfig());
      case "install":
        return await install(io, argv.includes("--client") ? flag("--client") : word());
      default:
        io.say(HELP);
        return argv[0] && !/^(help|--help|-h)$/.test(argv[0]) ? 2 : 0;
    }
  } catch (e: any) {
    io.say(`\nStopped: ${e?.shortMessage || e?.message || e}`);
    return 1;
  } finally {
    io.close();
  }
}

async function setup(io: Io, client?: string): Promise<number> {
  let cfg = loadConfig();
  const testnet = cfg.chainId === 11155111;
  io.say(`Telegraph setup\n\nNetwork: chain ${cfg.chainId}${testnet ? " (Ethereum Sepolia, beta 2: test USDC, no real money)" : ""}`);
  const intents = await getJson(`${cfg.url}/engine/v1/intents`, 20_000).then((d) => d.intents?.length ?? 0);
  io.say(`Node:    ${cfg.url} (reachable, ${intents} intents)`);

  if (cfg.privateKey) {
    io.say(`\nWallet:  ${privateKeyToAccount(cfg.privateKey).address}, already set up.`);
  } else {
    io.say("\nTelegraph pays for asks from a wallet made only for this, never your main one.");
    io.say("  1) Create a new wallet (recommended)\n  2) Import a private key you already have");
    const key = (await io.ask("Choose [1]: ")) === "2" ? await io.importKey() : newKey();
    if (!(await io.confirm(`Save it to ${walletPath(cfg.home)}, readable only by you?`, true))) return 1;
    io.say(`Saved. Address ${saveWallet(cfg.home, key)}. The key stays in that file; no agent config holds it.`);
    // Said before any money goes in, while there is nothing to lose yet.
    io.say(`Back up ${walletPath(cfg.home)} now. It is the only copy: lose it and the USDC in escrow is gone with it.`);
    cfg = loadConfig();
  }

  const funded = await fund(io, cfg);
  await install(io, client);
  io.say(
    funded === 0
      ? '\nDone. Restart your agent app, then ask it: "What is the BTC price? Use Telegraph."'
      : `\nOnce the wallet has USDC, run \`${RUN} fund\`, then restart your agent app.`,
  );
  return 0;
}

// Point the person at their address, network and balances, then move USDC into
// escrow after they confirm the amount.
// No usable key: either none yet, or a wallet file that cannot be read.
function noWallet(io: Io, cfg: Config): number {
  if (walletUnreadable(cfg.home)) {
    io.say(`${walletPath(cfg.home)} cannot be read, so its escrow cannot be reached. Restore your backup, or move the file aside and run \`${RUN} setup\` for a new wallet.`);
  } else {
    io.say(`No wallet yet. Run \`${RUN} setup\` first.`);
  }
  return 1;
}

async function fund(io: Io, cfg: Config, amount?: number): Promise<number> {
  if (!cfg.privateKey) return noWallet(io, cfg);
  const account = privateKeyToAccount(cfg.privateKey);
  const chain = new Chain(cfg);
  const a = await chain.account(account.address);
  const testnet = cfg.chainId === 11155111;
  io.say(`\nWallet ${a.address} on ${a.network}`);
  io.say(`  holds  ${a.wallet_usdc} USDC and ${a.wallet_eth} ETH for gas`);
  io.say(`  escrow ${a.escrow.spendable_usdc} USDC spendable${a.escrow.debt_usdc ? `, ${a.escrow.debt_usdc} USDC debt` : ""}`);
  io.say(`  USDC   ${a.usdc_token}${testnet ? " (beta 2's test token, not Circle's)" : ""}`);
  io.say("  An ask costs about $0.01, so $1 covers about 100 of them.");

  const want = amount ?? Number((await io.ask("How much USDC to move into escrow? [1]: ")) || 1);
  if (!(want > 0)) {
    io.say("Not an amount; nothing was moved.");
    return 1;
  }
  if (a.wallet_eth < 0.0005) {
    io.say(`\nThe wallet needs a little ETH for two transactions. Send some${testnet ? " Sepolia ETH (any public faucet)" : ""} to ${a.address}, then run \`${RUN} fund\`.`);
    return 1;
  }
  if (a.wallet_usdc < want) {
    io.say(
      `\nThe wallet holds ${a.wallet_usdc} USDC. Send at least ${want} USDC on ${a.network} to ${a.address}` +
        `${testnet ? `: claim it at ${FAUCET} (sign in, 1 USDC per account every 24 hours)` : ""}, then run \`${RUN} fund\`.`,
    );
    return 1;
  }
  if (!(await io.confirm(`Move ${want} USDC into Telegraph escrow (approve, then deposit: two transactions)?`, false))) return 1;
  const r = await chain.deposit(account, want);
  io.say(`Deposited. Escrow now ${r.escrow_now.spendable_usdc} USDC spendable. Transactions: ${r.transactions.join(", ")}`);
  return 0;
}

// Taking money back out: two transactions with a wait between them. Run once to
// request it, again to collect it.
async function withdraw(io: Io, cfg: Config, amount?: number): Promise<number> {
  if (!cfg.privateKey) return noWallet(io, cfg);
  const account = privateKeyToAccount(cfg.privateKey);
  const chain = new Chain(cfg);
  const a = await chain.account(account.address);

  if (a.escrow.pending_withdrawal_usdc > 0) {
    const u = await chain.withdrawalUnlock(account.address);
    if (!u.unlocked) {
      io.say(`\n${a.escrow.pending_withdrawal_usdc} USDC is already requested. It unlocks once the network settles block ${u.unlockSequence}, or at ${u.unlockAt.toISOString()} at the latest. Run \`${RUN} withdraw\` again then.`);
      return 1;
    }
    if (!(await io.confirm(`\nSend the requested ${a.escrow.pending_withdrawal_usdc} USDC to ${a.address}?`, true))) return 1;
    const done = await chain.executeWithdraw(account);
    io.say(`Withdrawn. Wallet now ${done.wallet_usdc} USDC; escrow ${done.escrow_now.spendable_usdc} USDC spendable. Transaction: ${done.transaction}`);
    return 0;
  }

  io.say(`\nEscrow ${a.escrow.spendable_usdc} USDC spendable${a.escrow.debt_usdc ? `, ${a.escrow.debt_usdc} USDC owed for asks already served` : ""}`);
  if (!(a.escrow.spendable_usdc > 0)) {
    io.say("There is nothing to take out.");
    return 1;
  }
  const want = amount ?? Number((await io.ask(`How much USDC to take out? [${a.escrow.spendable_usdc}]: `)) || a.escrow.spendable_usdc);
  if (!(want > 0)) {
    io.say("Not an amount; nothing was requested.");
    return 1;
  }
  if (want > a.escrow.spendable_usdc) {
    io.say(`Only ${a.escrow.spendable_usdc} USDC is spendable.`);
    return 1;
  }
  io.say("The amount stops paying for asks straight away, and what is already owed is still settled from it before it is paid out.");
  if (!(await io.confirm(`Request ${want} USDC out of escrow?`, false))) return 1;
  const r = await chain.requestWithdraw(account, want);
  io.say(`Requested. It unlocks once the network settles block ${r.unlock.unlockSequence}, or at ${r.unlock.unlockAt.toISOString()} at the latest. Run \`${RUN} withdraw\` then to collect it.`);
  return 0;
}

async function status(io: Io, cfg: Config): Promise<number> {
  if (!cfg.privateKey) return noWallet(io, cfg);
  const a = await new Chain(cfg).account(privateKeyToAccount(cfg.privateKey).address);
  const limits = { max_per_ask_usd: cfg.maxAskUsd, daily_usd: cfg.dailyLimitUsd, spent_today_usd: new SpendLog(cfg.home).today() };
  io.say(JSON.stringify({ ...a, node: cfg.url, payment: cfg.payment, limits }, null, 2));
  return 0;
}

// Where the apps with a plain mcpServers JSON file keep it. Any other app has
// its own format, which its section of the setup guide shows.
function configFile(app: string): string | undefined {
  const h = homedir();
  if (app === "cursor") return join(h, ".cursor/mcp.json");
  if (app !== "claude-desktop") return undefined;
  if (platform() === "darwin") return join(h, "Library/Application Support/Claude/claude_desktop_config.json");
  if (platform() === "win32") return join(process.env.APPDATA || join(h, "AppData/Roaming"), "Claude/claude_desktop_config.json");
  return join(h, ".config/Claude/claude_desktop_config.json");
}

async function install(io: Io, which?: string): Promise<number> {
  const app = (which || (await io.ask("\nAdd Telegraph to which app (claude-desktop, cursor, claude-code; empty to skip)? "))).toLowerCase();
  if (!app || app === "none" || app === "skip") return 0;
  if (app === "claude-code") {
    io.say(`\nRun this once: claude mcp add --scope user telegraph -- ${RUN}`);
    return 0;
  }
  const file = configFile(app);
  if (!file) {
    io.say(`\nFor ${app}, follow its section of the setup guide: ${GUIDE}\nNo key or setting is needed: the wallet from setup is used.`);
    return 0;
  }
  if (!(await io.confirm(`Add Telegraph to ${file}? (the old file is kept as .bak)`, true))) return 1;
  mkdirSync(dirname(file), { recursive: true });
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text) copyFileSync(file, `${file}.bak`);
  const doc = text ? JSON.parse(text) : {};
  doc.mcpServers = { ...doc.mcpServers, telegraph: SERVER };
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  io.say(`Added. Restart ${app} to load it.`);
  return 0;
}

// Questions for a person at a terminal. With --yes every question takes its
// default and every confirmation is a yes, for scripts and tests.
class Io {
  private rl = createInterface({ input: process.stdin, output: process.stdout });

  constructor(private yes: boolean) {}

  say(s: string) {
    process.stdout.write(s + "\n");
  }

  async ask(q: string): Promise<string> {
    return this.yes ? "" : (await this.rl.question(q)).trim();
  }

  async confirm(q: string, dflt: boolean): Promise<boolean> {
    if (this.yes) {
      this.say(`${q} yes (--yes)`);
      return true;
    }
    const a = (await this.rl.question(`${q} [${dflt ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
    return a ? a.startsWith("y") : dflt;
  }

  // Reads a private key without echoing it, so it stays out of the terminal.
  async importKey(): Promise<`0x${string}`> {
    const out = process.stdout as any;
    const write = out.write.bind(out);
    const q = "Paste the private key (hidden): ";
    out.write = (c: any, ...r: any[]) => (String(c).startsWith(q) ? write(q, ...r) : true);
    try {
      const raw = (await this.rl.question(q)).trim();
      return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    } finally {
      out.write = write;
      write("\n");
    }
  }

  close() {
    this.rl.close();
  }
}
