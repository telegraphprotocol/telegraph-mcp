import { homedir } from "node:os";
import { join } from "node:path";
import { readWalletKey } from "./wallet.js";

// escrow: pay every ask from the Telegraph escrow balance, nothing else (default).
// x402: pay each ask from the wallet's USDC instead. auto: escrow, then x402.
export type PaymentMode = "auto" | "escrow" | "x402";

export interface Config {
  url: string; // the node's public base URL
  privateKey?: `0x${string}`;
  payment: PaymentMode;
  diamond: `0x${string}`;
  chainId: number;
  rpcUrl: string;
  home: string; // where the wallet and the spending record live
  maxAskUsd: number; // refuse to sign for one ask above this
  dailyLimitUsd: number; // refuse to sign once today's asks reach this
  agentDeposit: boolean; // also give the agent a telegraph_deposit tool
}

// Telegraph beta 2 on Ethereum Sepolia: the default network, so the server
// works with no settings at all.
const DEFAULTS = {
  url: "https://devnode.telegraphprotocol.com",
  diamond: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b",
  chainId: 11155111,
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
};

const number = (raw: string | undefined, fallback: number, what: string) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a number of 0 or more`);
  return n;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.TELEGRAPH_HOME || join(homedir(), ".telegraph");
  // TELEGRAPH_EVM_PRIVATE_KEY is the v1 name, still accepted. Without either,
  // the wallet `setup` saved is used, so no client config ever holds a key.
  const key = (env.TELEGRAPH_PRIVATE_KEY || env.TELEGRAPH_EVM_PRIVATE_KEY || readWalletKey(home) || "").trim();
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("TELEGRAPH_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  const payment = (env.TELEGRAPH_PAYMENT || "escrow").toLowerCase();
  if (payment !== "auto" && payment !== "escrow" && payment !== "x402") {
    throw new Error("TELEGRAPH_PAYMENT must be escrow, x402 or auto");
  }
  const diamond = env.TELEGRAPH_DIAMOND || DEFAULTS.diamond;
  if (!/^0x[0-9a-fA-F]{40}$/.test(diamond)) throw new Error("TELEGRAPH_DIAMOND must be an address");
  return {
    url: (env.TELEGRAPH_URL || DEFAULTS.url).replace(/\/+$/, ""),
    privateKey: key ? (key as `0x${string}`) : undefined,
    payment,
    diamond: diamond as `0x${string}`,
    chainId: Number(env.TELEGRAPH_CHAIN_ID || DEFAULTS.chainId),
    rpcUrl: env.TELEGRAPH_RPC_URL || DEFAULTS.rpcUrl,
    home,
    maxAskUsd: number(env.TELEGRAPH_MAX_ASK_USD, 0.5, "TELEGRAPH_MAX_ASK_USD"),
    dailyLimitUsd: number(env.TELEGRAPH_DAILY_LIMIT_USD, 5, "TELEGRAPH_DAILY_LIMIT_USD"),
    agentDeposit: /^(1|true|yes)$/i.test(env.TELEGRAPH_ALLOW_AGENT_DEPOSIT || ""),
  };
}
