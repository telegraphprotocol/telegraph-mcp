import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// The wallet that pays for asks lives in its own file, mode 0600, read only by
// this MCP server. No agent config, tool result or log ever holds the key.

export const walletPath = (home: string) => join(home, "wallet.json");

export function readWalletKey(home: string): string | undefined {
  const file = walletPath(home);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).privateKey : undefined;
}

// Refuses to replace a wallet that already exists: it may hold funds.
export function saveWallet(home: string, key: `0x${string}`): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("A private key is 0x and 64 hex characters.");
  const file = walletPath(home);
  if (existsSync(file)) throw new Error(`A wallet already exists at ${file}. Move it away first to replace it.`);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const address = privateKeyToAccount(key).address;
  writeFileSync(file, JSON.stringify({ address, privateKey: key, createdAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return address;
}

export const newKey = generatePrivateKey;
