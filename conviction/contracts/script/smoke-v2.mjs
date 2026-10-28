import { writeFileSync } from "node:fs";
import { decodeEventLog, parseAbi, parseUnits } from "viem";
import {
  accountFor,
  assertArcTestnet,
  deployment,
  explorerUrl,
  publicClient as pub,
  sendContract,
  usdc,
  walletClientFor,
} from "./demo-round-common.mjs";

// Smoke rounds for the v2 deployment. The keeper (npm run keeper:run) must be running; it does
// collapse, the vault's trade and settlement. This script only plays the participants.
//   node --env-file=.env contracts/script/smoke-v2.mjs a     (full path, one depositor)
//   node --env-file=.env contracts/script/smoke-v2.mjs b     (empty round)
const mode = process.argv[2];
const C = deployment.contracts;
const TRADING_SECONDS = Number(process.env.SMOKE_TRADING_SECONDS ?? 420);
const u = (v) => parseUnits(String(v), 6);
const f6 = (v) => (Number(v) / 1e6).toFixed(6);
const f18 = (v) => (Number(v) / 1e18).toFixed(6);

const D = accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer");
const K = accountFor(process.env.KEEPER_PK, deployment.keeper, "keeper");
const wallet = { D: walletClientFor(D), K: walletClientFor(K) };

const roundAbi = parseAbi([
  "function roundCount() view returns (uint256)",
  "function protocolLiquiditySeed() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
  "function creditsClaimed(uint256,uint256,address) view returns (uint256)",
  "function roundWinningSeed(uint256) view returns (uint256)",
  "function winnerIsStatusQuo(uint256) view returns (bool)",
  "function openRound(uint64,uint64,uint96,uint96,uint32)",
  "function propose(uint256,(uint16 tEthBps),string)",
  "function deposit(uint256,uint256)",
  "function claimCredits(uint256,uint256,uint256)",
  "function buyLong(uint256,uint256,uint256,uint256)",
  "function buyShort(uint256,uint256,uint256,uint256)",
  "function sellLong(uint256,uint256,uint256,uint256)",
  "function sellShort(uint256,uint256,uint256,uint256)",
  "function redeem(uint256)",
  "event Redeemed(uint256 indexed roundId, address indexed user, uint256 payout)",
]);
const marketAbi = parseAbi([
  "function quoteBuyLong(uint256,uint256,uint256) view returns (uint256)",
  "function quoteBuyShort(uint256,uint256,uint256) view returns (uint256)",
  "function quoteSellLong(uint256,uint256,uint256) view returns (uint256 creditsOut,uint256 longDust,uint256 shortDust)",
  "function quoteSellShort(uint256,uint256,uint256) view returns (uint256 creditsOut,uint256 longDust,uint256 shortDust)",
  "function poolKey(uint256,uint256) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "function completeSetScale() view returns (uint256)",
]);
const hookAbi = parseAbi(["function pLong((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)) view returns (uint256)"]);
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
  "function totalVaultUsdc() view returns (uint256)",
  "function totalVaultTEth() view returns (uint256)",
  "function roundState(uint256) view returns (uint256,uint256,uint256,uint256,uint64,bool executed,bool reported,bool cancelled)",
]);

const log = [];
const out = (line) => console.log(line);
async function send(who, label, address, abi, fn, args) {
  const hash = await sendContract(label, wallet[who], address, abi, fn, args);
  log.push({ label, wallet: who, hash, url: `${explorerUrl}/tx/${hash}` });
  return hash;
}
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const bal = (token, owner) => read(token, erc20Abi, "balanceOf", [owner]);
const addr = (who) => (who === "D" ? D.address : K.address);
async function approve(who, spender, amount) {
  if ((await read(C.usdc, erc20Abi, "allowance", [addr(who), spender])) >= amount) return;
  await send(who, `${who} approves USDC to ${spender.slice(0, 8)}`, C.usdc, erc20Abi, "approve", [spender, amount]);
}
async function snapshot() {
  return {
    D: await bal(C.usdc, D.address),
    K: await bal(C.usdc, K.address),
    reserve: await read(C.quantumRound, roundAbi, "protocolLiquiditySeed"),
    roundUsdc: await bal(C.usdc, C.quantumRound),
    registryUsdc: await bal(C.usdc, C.proposerRegistry),
    vaultUsdc: await read(C.vault, vaultAbi, "totalVaultUsdc"),
    vaultTEth: await read(C.vault, vaultAbi, "totalVaultTEth"),
  };
}
const show = (s) =>
  `D ${f6(s.D)} | K ${f6(s.K)} | reserve ${f6(s.reserve)} | round contract ${f6(s.roundUsdc)} | registry ${f6(s.registryUsdc)} | vault ${f6(s.vaultUsdc)} USDC + ${f18(s.vaultTEth)} tETH`;

async function waitSettled(R) {
  for (;;) {
    const r = await read(C.quantumRound, roundAbi, "rounds", [R]);
    if (r[10] || r[13]) return r;
    out(`${new Date().toISOString()}  waiting for keeper: collapsed=${r[9]} settled=${r[10]} cancelled=${r[13]}`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}

async function openRound() {
  const block = await pub.getBlock({ blockTag: "latest" });
  const tradingEnd = block.timestamp + BigInt(TRADING_SECONDS);
  await send("K", "Open round", C.quantumRound, roundAbi, "openRound", [tradingEnd, 60n, 950000000000000000n, 1050000000000000000n, 60]);
  const R = await read(C.quantumRound, roundAbi, "roundCount");
  out(`Round ${R} open; trading ends ${new Date(Number(tradingEnd) * 1000).toISOString()}`);
  return R;
}

function save(extra) {
  const path = new URL(`../deployments/smoke-v2-${mode}.json`, import.meta.url);
  writeFileSync(path, JSON.stringify({ explorerUrl, log, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function runB() {
  const before = await snapshot();
  out(`[before] ${show(before)}`);
  const R = await openRound();
  const opened = await snapshot();
  out(`[after open] ${show(opened)}`);
  const vaultBefore = { usdc: opened.vaultUsdc, tEth: opened.vaultTEth };
  const round = await waitSettled(R);
  const after = await snapshot();
  const state = await read(C.vault, vaultAbi, "roundState", [R]);
  out(`[after settle] ${show(after)}`);
  const report = {
    round: R,
    winner: round[8],
    statusQuoWon: await read(C.quantumRound, roundAbi, "winnerIsStatusQuo", [R]),
    deposits: round[12],
    vaultUnchanged: vaultBefore.usdc === after.vaultUsdc && vaultBefore.tEth === after.vaultTEth,
    vaultExecuted: state[5],
    reserveBefore: before.reserve,
    reserveAfterSettle: after.reserve,
    seedReturnedWithoutRedeem: before.reserve === after.reserve,
  };
  out(JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  save({ before, after, report });
}

async function runA() {
  const before = await snapshot();
  out(`[before] ${show(before)}`);
  await approve("D", C.proposerRegistry, u(2));
  await approve("K", C.proposerRegistry, u(1));
  await approve("D", C.quantumRound, u(1));
  const R = await openRound();
  const plan = [["D", 2000], ["K", 5000], ["D", 8000]];
  for (const [who, bps] of plan) {
    await send(who, `${who} proposes ${bps / 100}% tETH`, C.quantumRound, roundAbi, "propose", [R, { tEthBps: bps }, `ipfs://wave/smoke-v2/${bps}`]);
  }
  const tok = (kind, p) => read(C.tokens ?? C.proposalTokens, tokensAbi, kind, [R, BigInt(p)]);
  const pLong = async (p) => (await read(C.waveHook, hookAbi, "pLong", [await read(C.market, marketAbi, "poolKey", [R, BigInt(p)])])) / 10n ** 12n;
  const probs = async () => (await Promise.all([0, 1, 2, 3].map(pLong))).map(f6);

  await send("D", "D deposits 1 USDC", C.quantumRound, roundAbi, "deposit", [R, u(1)]);
  for (const p of [0, 1, 2, 3]) {
    await send("D", `D claims 1 credit on proposal ${p}`, C.quantumRound, roundAbi, "claimCredits", [R, BigInt(p), u(1)]);
  }
  // Per-proposal cap: a second claim on any proposal must fail even though other proposals were claimed.
  let capHeld = false;
  try {
    await pub.simulateContract({ account: D, address: C.quantumRound, abi: roundAbi, functionName: "claimCredits", args: [R, 1n, 1n] });
  } catch {
    capHeld = true;
  }
  out(`Claim above the deposit on proposal 1 reverts: ${capHeld}`);

  const minOf = (v) => (v * 995n) / 1000n;
  async function buy(kind, p, credits) {
    const quote = await read(C.market, marketAbi, kind === "LONG" ? "quoteBuyLong" : "quoteBuyShort", [R, BigInt(p), u(credits)]);
    await send("D", `D buys ${kind} on proposal ${p} with ${credits} credits (quote ${f18(quote)})`, C.quantumRound, roundAbi, kind === "LONG" ? "buyLong" : "buyShort", [R, BigInt(p), u(credits), minOf(quote)]);
  }
  async function sellHalf(kind, p) {
    const token = await tok(kind === "LONG" ? "longToken" : "shortToken", p);
    const amount = (await bal(token, D.address)) / 2n;
    const [creditsOut] = await read(C.market, marketAbi, kind === "LONG" ? "quoteSellLong" : "quoteSellShort", [R, BigInt(p), amount]);
    await send("D", `D sells ${f18(amount)} ${kind} on proposal ${p} (quote ${f6(creditsOut)} credits)`, C.quantumRound, roundAbi, kind === "LONG" ? "sellLong" : "sellShort", [R, BigInt(p), amount, minOf(creditsOut)]);
  }
  await buy("LONG", 2, 1);
  await buy("SHORT", 1, 1);
  await buy("SHORT", 3, 1);
  await sellHalf("LONG", 2);
  await sellHalf("SHORT", 1);
  await sellHalf("SHORT", 3);
  const probsBefore = await probs();
  out(`pLong by proposal: ${probsBefore.join(", ")}`);

  const round = await waitSettled(R);
  if (round[13]) throw new Error("Round was cancelled; stopping for review.");
  const winner = round[8];
  const state = await read(C.vault, vaultAbi, "roundState", [R]);
  out(`Winner: proposal ${winner}; vault executed=${state[5]}, reported=${state[6]}; realisedReturn ${round[11]}`);

  // Expected redemption: deposit - claimed[winner] + credits + LONG*pi + SHORT*(1-pi).
  const [deposit, claimed] = [u(1), await read(C.quantumRound, roundAbi, "creditsClaimed", [R, winner, D.address])];
  const [credit, long, short] = await Promise.all([tok("creditToken", winner), tok("longToken", winner), tok("shortToken", winner)]);
  const [cb, lb, sb] = await Promise.all([bal(credit, D.address), bal(long, D.address), bal(short, D.address)]);
  const clamped = round[11] < BigInt(round[3]) ? BigInt(round[3]) : round[11] > BigInt(round[4]) ? BigInt(round[4]) : round[11];
  const piN = clamped - BigInt(round[3]);
  const piD = BigInt(round[4]) - BigInt(round[3]);
  const scale = await read(C.market, marketAbi, "completeSetScale");
  const expected = deposit - claimed + cb + (lb * piN) / (piD * scale) + (sb * (piD - piN)) / (piD * scale);
  const preRedeem = await snapshot();
  const hash = await send("D", "D redeems", C.quantumRound, roundAbi, "redeem", [R]);
  const receipt = await pub.getTransactionReceipt({ hash });
  let paid = 0n;
  for (const l of receipt.logs) {
    try {
      const e = decodeEventLog({ abi: roundAbi, data: l.data, topics: l.topics });
      if (e.eventName === "Redeemed") paid = e.args.payout;
    } catch {}
  }
  const after = await snapshot();
  out(`[after redeem] ${show(after)}`);
  const report = {
    round: R,
    winner,
    probsBefore,
    claimedWinner: claimed,
    creditsWinner: cb,
    longWinner: lb,
    shortWinner: sb,
    expectedPayout: expected,
    redeemedPayout: paid,
    matches: expected === paid || (expected > paid ? expected - paid : paid - expected) <= 2n,
    perProposalCapHeld: capHeld,
    reserveBefore: before.reserve,
    reserveAfterRedeem: after.reserve,
    reserveDiff: after.reserve - before.reserve,
    roundContractUsdcAfter: after.roundUsdc,
    unaccountedRoundUsdc: after.roundUsdc - after.reserve,
  };
  out(JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  save({ before, preRedeem, after, report });
}

await assertArcTestnet();
if (mode === "a") await runA();
else if (mode === "b") await runB();
else throw new Error("Usage: smoke-v2.mjs a|b");
