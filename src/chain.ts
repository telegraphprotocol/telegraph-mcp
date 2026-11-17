import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi, parseUnits, toFunctionSelector } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { getJson } from "./http.js";

// The ledger diamond: deposits and withdrawal requests are on chain; charges and
// credits are in the node's ledger roots, so balances are read from the node.
const escrowAbi = parseAbi([
  "function usdcToken() view returns (address)",
  "function withdrawalStatus(address user) view returns (uint256 requested, uint256 requestedAt, uint256 needsCutoff, uint256 fallbackAt, bool unlocked)",
  "function depositUSDC(uint256 amount)",
  "function requestWithdraw(uint256 amount)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// executeWithdraw and executeWithdrawFallback: the only calls a node's proof may make.
const WITHDRAW_SELECTORS = [
  "executeWithdraw(uint64,(uint32,address,uint64,uint64,bytes)[])",
  "executeWithdrawFallback(uint64,(uint32,address,uint64,uint64,bytes)[][])",
].map((sig): string => toFunctionSelector(`function ${sig}`));

const usd = (v: bigint) => Number(formatUnits(v, 6));
// The node's ledger amounts are μUSDC decimal strings.
const usdOf = (v: unknown) => Number(v ?? 0) / 1e6;
const at = (unix: unknown) => (Number(unix) > 0 ? new Date(Number(unix) * 1000).toISOString() : undefined);

export class Chain {
  private chain;
  private pub;
  private usdc?: `0x${string}`;

  constructor(private cfg: Config) {
    this.chain = defineChain({
      id: cfg.chainId,
      name: `eip155:${cfg.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });
    this.pub = createPublicClient({ chain: this.chain, transport: http(cfg.rpcUrl) });
  }

  private async usdcAddress(): Promise<`0x${string}`> {
    this.usdc ??= await this.pub.readContract({ address: this.cfg.diamond, abi: escrowAbi, functionName: "usdcToken" });
    return this.usdc;
  }

  // GET /v1/ledger/account: the balance asks spend against, and any withdrawal request.
  private ledger(address: `0x${string}`) {
    return getJson(`${this.cfg.url}/v1/ledger/account/${address}`);
  }

  async account(address: `0x${string}`) {
    const usdc = await this.usdcAddress();
    const [wallet, eth, l] = await Promise.all([
      this.pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      this.pub.getBalance({ address }),
      this.ledger(address),
    ]);
    return {
      address,
      network: `eip155:${this.cfg.chainId}`,
      // Which token is actually spent, and which contract holds the escrow:
      // both read from the chain, so they follow the node's network.
      usdc_token: usdc,
      escrow_contract: this.cfg.diamond,
      wallet_usdc: usd(wallet),
      wallet_eth: Number(formatUnits(eth, 18)),
      escrow: {
        spendable_usdc: usdOf(l.available),
        balance_usdc: usdOf(l.balance),
        deposited_usdc: usdOf(l.deposited),
        unbilled_usdc: usdOf(l.unbilled),
        pending_withdrawal_usdc: usdOf(l.request?.amount),
        withdrawal_status: l.request?.status ?? "none",
      },
    };
  }

  // approve (when the allowance is short) then depositUSDC, waiting for each.
  async deposit(account: PrivateKeyAccount, amountUsd: number) {
    const amount = parseUnits(amountUsd.toFixed(6), 6);
    const usdc = await this.usdcAddress();
    const have = await this.pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    if (have < amount) throw new Error(`The wallet holds ${usd(have)} USDC, less than ${amountUsd}.`);

    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.cfg.rpcUrl) });
    // Explicit nonces: some public RPCs hand back a stale pending nonce.
    let nonce = await this.pub.getTransactionCount({ address: account.address, blockTag: "pending" });
    const txs: string[] = [];
    const allowance = await this.pub.readContract({
      address: usdc, abi: erc20Abi, functionName: "allowance", args: [account.address, this.cfg.diamond],
    });
    if (allowance < amount) {
      const hash = await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [this.cfg.diamond, amount], nonce: nonce++ });
      await this.waitOk(hash, "approve");
      txs.push(hash);
    }
    const hash = await wallet.writeContract({ address: this.cfg.diamond, abi: escrowAbi, functionName: "depositUSDC", args: [amount], nonce });
    await this.waitOk(hash, "depositUSDC");
    txs.push(hash);
    return { amount_usdc: amountUsd, transactions: txs, escrow_now: (await this.account(account.address)).escrow };
  }

  // Where a withdrawal request stands, by the node: "ready" or "fallback_open"
  // can be executed; "waiting_root" and "waiting_activation" wait for a ledger
  // root that covers the request to activate.
  async withdrawal(address: `0x${string}`) {
    const r = (await this.ledger(address)).request || {};
    return { status: String(r.status || "none"), amount_usdc: usdOf(r.amount), fallback_at: at(r.fallback_at) };
  }

  // Taking money out is two steps on chain, with a wait between them: the
  // amount stops paying for asks at once, and is paid out against a ledger root
  // that covers the request, so asks already served are charged first.
  async requestWithdraw(account: PrivateKeyAccount, amountUsd: number) {
    const amount = parseUnits(amountUsd.toFixed(6), 6);
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.cfg.rpcUrl) });
    const hash = await wallet.writeContract({ address: this.cfg.diamond, abi: escrowAbi, functionName: "requestWithdraw", args: [amount] });
    await this.waitOk(hash, "requestWithdraw");
    const [, , needsCutoff, fallbackAt] = await this.pub.readContract({
      address: this.cfg.diamond, abi: escrowAbi, functionName: "withdrawalStatus", args: [account.address],
    });
    return { amount_usdc: amountUsd, transaction: hash, needs_root_after: at(needsCutoff), fallback_at: at(fallbackAt) };
  }

  // Sends the node's ready-made executeWithdraw (or, past the fallback time,
  // executeWithdrawFallback) calldata, which carries the proof of this account.
  async executeWithdraw(account: PrivateKeyAccount) {
    const proof = await getJson(`${this.cfg.url}/v1/ledger/proof/${account.address}`);
    const data = String(proof.calldata || "");
    if (!/^0x[0-9a-fA-F]+$/.test(data) || !WITHDRAW_SELECTORS.includes(data.slice(0, 10).toLowerCase())) {
      throw new Error("the node returned no withdrawal calldata");
    }
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.cfg.rpcUrl) });
    const hash = await wallet.sendTransaction({ to: this.cfg.diamond, data: data as `0x${string}` });
    await this.waitOk(hash, "executeWithdraw");
    const after = await this.account(account.address);
    return { transaction: hash, wallet_usdc: after.wallet_usdc, escrow_now: after.escrow };
  }

  private async waitOk(hash: `0x${string}`, what: string) {
    const r = await this.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`${what} reverted (tx ${hash})`);
  }
}
