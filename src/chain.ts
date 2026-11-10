import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi, parseUnits } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Config } from "./config.js";

const escrowAbi = parseAbi([
  "function usdcToken() view returns (address)",
  "function effectiveBalance(address user) view returns (uint256)",
  "function escrowBalance(address user) view returns (uint256)",
  "function agentDebt(address user) view returns (uint256)",
  "function pendingWithdrawal(address user) view returns (uint256 amount, uint256 unlockTime)",
  "function withdrawalUnlock(address user) view returns (uint256 unlockSequence, uint256 unlockTime, bool unlocked)",
  "function depositUSDC(uint256 amount)",
  "function requestWithdraw(uint256 amount)",
  "function executeWithdraw()",
  "function cancelWithdraw()",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const usd = (v: bigint) => Number(formatUnits(v, 6));

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

  async account(address: `0x${string}`) {
    const usdc = await this.usdcAddress();
    const read = (functionName: "effectiveBalance" | "escrowBalance" | "agentDebt") =>
      this.pub.readContract({ address: this.cfg.diamond, abi: escrowAbi, functionName, args: [address] });
    const [wallet, eth, spendable, deposited, debt, pending] = await Promise.all([
      this.pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      this.pub.getBalance({ address }),
      read("effectiveBalance"),
      read("escrowBalance"),
      read("agentDebt"),
      this.pub.readContract({ address: this.cfg.diamond, abi: escrowAbi, functionName: "pendingWithdrawal", args: [address] }),
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
        spendable_usdc: usd(spendable),
        deposited_usdc: usd(deposited),
        debt_usdc: usd(debt),
        pending_withdrawal_usdc: usd(pending[0]),
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

  // When a pending withdrawal may be executed: once `withdrawBlocks` more
  // settlement blocks pass, or at `unlockTime`, whichever comes first.
  async withdrawalUnlock(address: `0x${string}`) {
    const [unlockSequence, unlockTime, unlocked] = await this.pub.readContract({
      address: this.cfg.diamond, abi: escrowAbi, functionName: "withdrawalUnlock", args: [address],
    });
    return { unlockSequence, unlockAt: new Date(Number(unlockTime) * 1000), unlocked };
  }

  // Taking money out is two steps on chain, with a wait between them: the
  // amount leaves the spendable balance at once, and settlement still collects
  // what the agent already owes from it.
  async requestWithdraw(account: PrivateKeyAccount, amountUsd: number) {
    const amount = parseUnits(amountUsd.toFixed(6), 6);
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.cfg.rpcUrl) });
    const hash = await wallet.writeContract({ address: this.cfg.diamond, abi: escrowAbi, functionName: "requestWithdraw", args: [amount] });
    await this.waitOk(hash, "requestWithdraw");
    return { amount_usdc: amountUsd, transaction: hash, unlock: await this.withdrawalUnlock(account.address) };
  }

  async executeWithdraw(account: PrivateKeyAccount) {
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.cfg.rpcUrl) });
    const hash = await wallet.writeContract({ address: this.cfg.diamond, abi: escrowAbi, functionName: "executeWithdraw" });
    await this.waitOk(hash, "executeWithdraw");
    const after = await this.account(account.address);
    return { transaction: hash, wallet_usdc: after.wallet_usdc, escrow_now: after.escrow };
  }

  private async waitOk(hash: `0x${string}`, what: string) {
    const r = await this.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`${what} reverted (tx ${hash})`);
  }
}
