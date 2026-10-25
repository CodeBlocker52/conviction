import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fetchCoinbasePrice } from "./demo-round-common.mjs";

// Phase B smoke round against the NEW (not yet current) deployment. Usage:
//   node --env-file=.env contracts/script/phase-b-smoke-round.mjs --execute
const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const explorer = "https://explorer.testnet.arc.io";
const A = {
  usdc: "0x3600000000000000000000000000000000000000",
  tokens: "0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E",
  market: "0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A",
  round: "0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5",
  vault: "0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865",
  hook: "0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0",
  registry: "0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346",
  oracle: "0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d",
};
const TRADING_SECONDS = Number(process.env.SMOKE_TRADING_SECONDS ?? 480);
const TWAP_WINDOW = 60;
const HORIZON = 60;
const SLIPPAGE_BPS = 50n;
const u = (v) => parseUnits(String(v), 6);
const fmt6 = (v) => (Number(v) / 1e6).toFixed(6);
const fmt18 = (v) => (Number(v) / 1e18).toFixed(6);

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const D = privateKeyToAccount(process.env.DEPLOYER_PK);
const K = privateKeyToAccount(process.env.KEEPER_PK);
const wallets = { D: createWalletClient({ account: D, chain, transport: http(rpcUrl) }), K: createWalletClient({ account: K, chain, transport: http(rpcUrl) }) };

const roundAbi = parseAbi([
  "function roundCount() view returns (uint256)",
  "function protocolLiquiditySeed() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
  "function proposals(uint256,uint256) view returns (uint256 id,address proposer,uint16 tEthBps,string rationaleURI,uint256 bondAmount,bool bondRefunded,bool isStatusQuo)",
  "function roundRemainingCollateral(uint256) view returns (uint256)",
  "function roundWinningSeed(uint256) view returns (uint256)",
  "function openRound(uint64,uint64,uint96,uint96,uint32)",
  "function propose(uint256,(uint16 tEthBps),string)",
  "function deposit(uint256,uint256)",
  "function claimCredits(uint256,uint256,uint256)",
  "function buyLong(uint256,uint256,uint256,uint256)",
  "function buyShort(uint256,uint256,uint256,uint256)",
  "function sellLong(uint256,uint256,uint256,uint256)",
  "function sellShort(uint256,uint256,uint256,uint256)",
  "function collapse(uint256)",
  "function redeem(uint256)",
]);
const marketAbi = parseAbi([
  "function quoteBuyLong(uint256,uint256,uint256) view returns (uint256)",
  "function quoteBuyShort(uint256,uint256,uint256) view returns (uint256)",
  "function quoteSellLong(uint256,uint256,uint256) view returns (uint256 creditsOut,uint256 longDust,uint256 shortDust)",
  "function quoteSellShort(uint256,uint256,uint256) view returns (uint256 creditsOut,uint256 longDust,uint256 shortDust)",
  "function poolKey(uint256,uint256) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
]);
const hookAbi = parseAbi([
  "function pLong((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)) view returns (uint256)",
]);
const tokensAbi = parseAbi([
  "function creditToken(uint256,uint256) view returns (address)",
  "function longToken(uint256,uint256) view returns (address)",
  "function shortToken(uint256,uint256) view returns (address)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const vaultAbi = parseAbi([
  "function executeTrade(uint256,uint16)",
  "function reportReturn(uint256)",
  "function totalVaultUsdc() view returns (uint256)",
  "function totalVaultTEth() view returns (uint256)",
]);
const oracleAbi = parseAbi(["function updatePrice(int256)"]);
const registryAbi = parseAbi([
  "function agents(address) view returns (string name,address wallet,bool active,uint256 proposalCount,uint256 winCount,int256 cumulativeReturn)",
  "function bonds(address) view returns (uint256)",
]);

const log = [];
const gasSpent = { D: 0n, K: 0n };
const logPath = fileURLToPath(new URL("../deployments/phase-b-smoke.json", import.meta.url));
const save = (extra = {}) => writeFileSync(logPath, JSON.stringify({ explorer, log, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

// Fee policy: max fee = 2x the current base fee, 1 gwei priority.
async function fees() {
  const block = await pub.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? 20_000_000_000n;
  return { maxFeePerGas: base * 2n, maxPriorityFeePerGas: 1_000_000_000n };
}
async function send(who, label, address, abi, functionName, args) {
  const hash = await wallets[who].writeContract({ address, abi, functionName, args, ...(await fees()) });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  gasSpent[who] += receipt.gasUsed * receipt.effectiveGasPrice;
  log.push({ label, wallet: who, hash, url: `${explorer}/tx/${hash}` });
  console.log(`${label}: ${explorer}/tx/${hash}`);
  save();
  return hash;
}
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const bal = (token, who) => read(token, erc20Abi, "balanceOf", [who]);
async function ensureApproval(who, spender, amount) {
  const owner = who === "D" ? D.address : K.address;
  if ((await read(A.usdc, erc20Abi, "allowance", [owner, spender])) >= amount) return;
  await send(who, `${who} approves USDC to ${spender.slice(0, 8)}…`, A.usdc, erc20Abi, "approve", [spender, amount]);
}
async function waitUntil(ts) {
  for (;;) {
    const b = await pub.getBlock({ blockTag: "latest" });
    if (b.timestamp >= ts) return;
    await new Promise((r) => setTimeout(r, Math.min(Number(ts - b.timestamp) * 1000, 5000)));
  }
}
const seedNow = () => read(A.round, roundAbi, "protocolLiquiditySeed");
const roundUsdc = () => bal(A.usdc, A.round);

async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Pass --execute to send transactions.");
  if ((await pub.getChainId()) !== 5042002) throw new Error("RPC is not Arc Testnet.");
  const report = { walletsBefore: {}, walletsAfter: {}, seed: {} };

  report.walletsBefore = { D: await bal(A.usdc, D.address), K: await bal(A.usdc, K.address) };
  report.seed.beforeOpen = await seedNow();
  const roundBalanceBefore = await roundUsdc();
  console.log(`Seed before opening: ${fmt6(report.seed.beforeOpen)} USDC; round USDC balance ${fmt6(roundBalanceBefore)}`);
  if (report.seed.beforeOpen < u(20)) throw new Error("Need 20 USDC of protocol seed (4 markets x 5).");

  const [dAgent, kAgent] = await Promise.all([read(A.registry, registryAbi, "agents", [D.address]), read(A.registry, registryAbi, "agents", [K.address])]);
  if (!dAgent[2] || !kAgent[2]) throw new Error("Both wallets must be active proposers in ProposerRegistry.");

  // Approvals: bonds (D: 2, K: 1) and deposits (6 each).
  await ensureApproval("D", A.registry, u(2));
  await ensureApproval("K", A.registry, u(1));
  await ensureApproval("D", A.round, u(6));
  await ensureApproval("K", A.round, u(6));

  const open = await pub.getBlock({ blockTag: "latest" });
  const tradingEnd = open.timestamp + BigInt(TRADING_SECONDS);
  await send("K", "Open Phase B smoke round", A.round, roundAbi, "openRound", [tradingEnd, BigInt(HORIZON), 950000000000000000n, 1050000000000000000n, TWAP_WINDOW]);
  const R = await read(A.round, roundAbi, "roundCount");
  console.log(`Round ${R}; trading ends ${new Date(Number(tradingEnd) * 1000).toISOString()}`);

  const proposalsPlan = [
    ["D", 2000, "ipfs://wave/smoke/rebalance-20-tETH: raise tETH to 20% after the ETH momentum signal turned positive"],
    ["K", 5000, "ipfs://wave/smoke/rebalance-50-tETH: a 50% tETH tilt to capture the expected squeeze"],
    ["D", 8000, "ipfs://wave/smoke/rebalance-80-tETH: an aggressive 80% tETH allocation into the catalyst window"],
  ];
  for (const [who, bps, uri] of proposalsPlan) {
    await send(who, `${who} proposes ${bps / 100}% tETH`, A.round, roundAbi, "propose", [R, { tEthBps: bps }, uri]);
  }
  // P1 = 20% (D), P2 = 50% (K), P3 = 80% (D). Bonds locked: D 2, K 1.
  report.seed.afterProposals = await seedNow();

  const tok = (kind, pid) => read(A.tokens, tokensAbi, kind, [R, BigInt(pid)]);
  const pLong = async (pid) => read(A.hook, hookAbi, "pLong", [await read(A.market, marketAbi, "poolKey", [R, BigInt(pid)])]);
  const probs = async () => Promise.all([0, 1, 2, 3].map(async (p) => fmt6((await pLong(p)) / 10n ** 12n)));
  report.probsStart = await probs();

  await send("D", "D deposits 6 USDC", A.round, roundAbi, "deposit", [R, u(6)]);
  await send("K", "K deposits 6 USDC", A.round, roundAbi, "deposit", [R, u(6)]);
  for (const [who, pid, amt] of [["D", 2, 3], ["D", 1, 3], ["K", 2, 3], ["K", 3, 3]]) {
    await send(who, `${who} claims ${amt} credits on proposal ${pid}`, A.round, roundAbi, "claimCredits", [R, BigInt(pid), u(amt)]);
  }

  const minOf = (v) => (v * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  async function buy(who, kind, pid, credits) {
    const fn = kind === "LONG" ? "quoteBuyLong" : "quoteBuyShort";
    const quote = await read(A.market, marketAbi, fn, [R, BigInt(pid), u(credits)]);
    await send(who, `${who} buys ${kind} on proposal ${pid} with ${credits} credits (quote ${fmt18(quote)})`, A.round, roundAbi, kind === "LONG" ? "buyLong" : "buyShort", [R, BigInt(pid), u(credits), minOf(quote)]);
  }
  async function sellHalf(who, kind, pid) {
    const token = await tok(kind === "LONG" ? "longToken" : "shortToken", pid);
    const owner = who === "D" ? D.address : K.address;
    const amount = (await bal(token, owner)) / 2n;
    const fn = kind === "LONG" ? "quoteSellLong" : "quoteSellShort";
    const [creditsOut] = await read(A.market, marketAbi, fn, [R, BigInt(pid), amount]);
    await send(who, `${who} sells ${fmt18(amount)} ${kind} on proposal ${pid} (quote ${fmt6(creditsOut)} credits)`, A.round, roundAbi, kind === "LONG" ? "sellLong" : "sellShort", [R, BigInt(pid), amount, minOf(creditsOut)]);
  }

  // Proposal 2 (50% tETH) is pushed to win, so the vault must actually swap USDC into tETH.
  await buy("D", "LONG", 2, 2);
  await buy("D", "SHORT", 1, 1.5);
  await buy("K", "LONG", 2, 1);
  await buy("K", "SHORT", 3, 1.5);
  await sellHalf("D", "LONG", 2);
  await sellHalf("D", "SHORT", 1);
  await sellHalf("K", "LONG", 2);
  await sellHalf("K", "SHORT", 3);
  report.probsBeforeCollapse = await probs();
  console.log(`pLong by proposal before collapse: ${report.probsBeforeCollapse.join(", ")}`);
  const nowBlock = await pub.getBlock({ blockTag: "latest" });
  if (nowBlock.timestamp >= tradingEnd - BigInt(TWAP_WINDOW)) console.warn("WARNING: trading overlapped the final TWAP window.");

  await waitUntil(tradingEnd);
  await send("K", `Collapse round ${R}`, A.round, roundAbi, "collapse", [R]);
  let round = await read(A.round, roundAbi, "rounds", [R]);
  const winner = round[8];
  report.winner = winner;
  report.seed.afterCollapse = await seedNow();
  report.winningSeedHeld = await read(A.round, roundAbi, "roundWinningSeed", [R]);
  console.log(`Winner: proposal ${winner}; seed after collapse ${fmt6(report.seed.afterCollapse)} (winning seed held ${fmt6(report.winningSeedHeld)})`);
  report.bondsAfterCollapse = { D: await read(A.registry, registryAbi, "bonds", [D.address]), K: await read(A.registry, registryAbi, "bonds", [K.address]) };

  const winnerProposal = await read(A.round, roundAbi, "proposals", [R, winner]);
  const targetBps = winnerProposal[2];
  const cb = await fetchCoinbasePrice();
  await send("K", "Oracle update (pre-trade)", A.oracle, oracleAbi, "updatePrice", [cb.answer]);
  report.vaultBefore = { usdc: await read(A.vault, vaultAbi, "totalVaultUsdc"), tEth: await read(A.vault, vaultAbi, "totalVaultTEth") };
  await send("K", `WavefundVault executes proposal ${winner} (${targetBps} bps tETH)`, A.vault, vaultAbi, "executeTrade", [R, targetBps]);
  round = await read(A.round, roundAbi, "rounds", [R]);
  if (round[13]) throw new Error("Vault slippage guard cancelled the round.");
  report.vaultAfter = { usdc: await read(A.vault, vaultAbi, "totalVaultUsdc"), tEth: await read(A.vault, vaultAbi, "totalVaultTEth") };

  await waitUntil(round[2]);
  const cb2 = await fetchCoinbasePrice();
  await send("K", "Oracle update (settlement)", A.oracle, oracleAbi, "updatePrice", [cb2.answer]);
  await send("K", `WavefundVault reports NAV and settles round ${R}`, A.vault, vaultAbi, "reportReturn", [R]);
  round = await read(A.round, roundAbi, "rounds", [R]);
  if (!round[10]) throw new Error("Round not settled.");
  report.realisedReturn = round[11];
  report.seed.afterSettle = await seedNow();

  report.winnerIsStatusQuo = winner === 0n;
  const before = { D: await bal(A.usdc, D.address), K: await bal(A.usdc, K.address) };
  await send("D", "D redeems", A.round, roundAbi, "redeem", [R]);
  await send("K", "K redeems", A.round, roundAbi, "redeem", [R]);
  const after = { D: await bal(A.usdc, D.address), K: await bal(A.usdc, K.address) };
  report.payouts = { D: after.D - before.D, K: after.K - before.K };
  report.seed.afterRedemptions = await seedNow();
  report.roundBalanceAfter = await roundUsdc();
  report.remainingCollateral = await read(A.round, roundAbi, "roundRemainingCollateral", [R]);
  report.walletsAfter = { D: await bal(A.usdc, D.address), K: await bal(A.usdc, K.address) };
  report.gasSpent = gasSpent;
  report.roundId = R;
  save({ report });

  console.log("\n=== REPORT ===");
  console.log(`Seed: before ${fmt6(report.seed.beforeOpen)} | after proposals ${fmt6(report.seed.afterProposals)} | after collapse ${fmt6(report.seed.afterCollapse)} | after settle ${fmt6(report.seed.afterSettle)} | after redemptions ${fmt6(report.seed.afterRedemptions)}`);
  console.log(`Round contract USDC: before ${fmt6(roundBalanceBefore)} | after ${fmt6(report.roundBalanceAfter)}; remaining collateral ${fmt6(report.remainingCollateral)}`);
  const paid = report.payouts.D + report.payouts.K;
  const totalIn = u(12);
  const expectedBalance = roundBalanceBefore + totalIn - paid;
  console.log(`Reconciliation: reserve before ${fmt6(roundBalanceBefore)} + deposits ${fmt6(totalIn)} - payouts ${fmt6(paid)} = ${fmt6(expectedBalance)}; actual round USDC ${fmt6(report.roundBalanceAfter)}; difference ${fmt6(report.roundBalanceAfter - expectedBalance)}; seed reserve ${fmt6(report.seed.afterRedemptions)} (unaccounted dust ${fmt6(report.roundBalanceAfter - report.seed.afterRedemptions)})`);
  console.log(`Vault before: ${fmt6(report.vaultBefore.usdc)} USDC / ${fmt18(report.vaultBefore.tEth)} tETH; after: ${fmt6(report.vaultAfter.usdc)} USDC / ${fmt18(report.vaultAfter.tEth)} tETH`);
  console.log(`Payouts: D ${fmt6(report.payouts.D)} K ${fmt6(report.payouts.K)} (deposits 6.000000 each)`);
  console.log(`Wallet USDC D: ${fmt6(report.walletsBefore.D)} -> ${fmt6(report.walletsAfter.D)} (gas ${fmt18(report.gasSpent.D)}); K: ${fmt6(report.walletsBefore.K)} -> ${fmt6(report.walletsAfter.K)} (gas ${fmt18(report.gasSpent.K)})`);
}

main().catch((error) => {
  save({ error: String(error?.message ?? error) });
  console.error(error);
  process.exit(1);
});
