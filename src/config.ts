export type PaymentMode = "auto" | "escrow" | "x402";

export interface Config {
  url: string; // the node's public base URL
  privateKey?: `0x${string}`;
  payment: PaymentMode;
  diamond: `0x${string}`;
  chainId: number;
  rpcUrl: string;
}

// Telegraph beta 2 on Ethereum Sepolia: the default network, so the server
// works with no settings at all.
const DEFAULTS = {
  url: "https://devnode.telegraphprotocol.com",
  diamond: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b",
  chainId: 11155111,
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // TELEGRAPH_EVM_PRIVATE_KEY is the v1 name, still accepted.
  const key = (env.TELEGRAPH_PRIVATE_KEY || env.TELEGRAPH_EVM_PRIVATE_KEY || "").trim();
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("TELEGRAPH_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  const payment = (env.TELEGRAPH_PAYMENT || "auto").toLowerCase();
  if (payment !== "auto" && payment !== "escrow" && payment !== "x402") {
    throw new Error("TELEGRAPH_PAYMENT must be auto, escrow or x402");
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
  };
}
