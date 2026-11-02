// Read-only on-chain report for a round: parameters, proposals, TWAPs, winner, deposits, redemptions and bond refunds.
// Sends no transactions. Usage: node --env-file=.env contracts/script/round-report.mjs --round 10 [--json]
import { parseAbiItem, parseEventLogs } from "viem";
import { deployment, explorerUrl, publicClient, roundAbi, usdc } from "./demo-round-common.mjs";

const args = process.argv.slice(2);
const roundId = BigInt(args.includes("--round") ? args[args.indexOf("--round") + 1] : "0");
if (roundId <= 0n) throw new Error("Pass --round <id>.");

const address = deployment.contracts.quantumRound;
const events = {
  opened: parseAbiItem("event RoundOpened(uint256 indexed roundId, uint64 tradingEnd, uint64 evaluationEnd, uint96 rMin, uint96 rMax, uint32 twapWindow)"),
  proposal: parseAbiItem("event ProposalCreated(uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer, uint16 tEthBps, string rationaleURI)"),
  deposited: parseAbiItem("event Deposited(uint256 indexed roundId, address indexed user, uint256 amount)"),
  trade: parseAbiItem("event Trade(uint256 indexed roundId, uint256 indexed proposalId, address indexed user, string side, uint256 amountIn, uint256 amountOut)"),
  collapsed: parseAbiItem("event Collapsed(uint256 indexed roundId, uint256 winnerProposalId, uint256[] twaps)"),
  settled: parseAbiItem("event Settled(uint256 indexed roundId, int256 realisedReturn)"),
  cancelled: parseAbiItem("event RoundCancelled(uint256 indexed roundId)"),
  redeemed: parseAbiItem("event Redeemed(uint256 indexed roundId, address indexed user, uint256 payout)"),
  bond: parseAbiItem("event BondRefunded(uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer, uint256 amount)"),
};

const CHUNK = 9_000n;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withRetry = async (fn) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 6) throw error;
      await pause(1_000 * (attempt + 1));
    }
  }
};

const round = await publicClient.readContract({ address, abi: roundAbi, functionName: "rounds", args: [roundId] });
const latest = await publicClient.getBlockNumber();
const blockTime = async (number) => Number((await withRetry(() => publicClient.getBlock({ blockNumber: number }))).timestamp);

// First block at or after `timestamp`, by binary search on block time.
async function blockAtOrAfter(timestamp) {
  let low = 0n;
  let high = latest;
  while (low < high) {
    const middle = (low + high) / 2n;
    if (await blockTime(middle) < timestamp) low = middle + 1n;
    else high = middle;
  }
  return low;
}

// Rounds open for at most an hour before trading ends; redemptions can come hours after settlement.
const startBlock = await blockAtOrAfter(Number(round[1]) - 3_600);
const endTime = Number(round[2]) + 6 * 3_600;
const endBlock = (await blockTime(latest)) <= endTime ? latest : await blockAtOrAfter(endTime);
const rawLogs = [];
for (let from = startBlock; from <= endBlock; from += CHUNK) {
  const to = from + CHUNK - 1n < endBlock ? from + CHUNK - 1n : endBlock;
  rawLogs.push(...await withRetry(() => publicClient.getLogs({ address, fromBlock: from, toBlock: to })));
}
const decoded = parseEventLogs({ abi: Object.values(events), logs: rawLogs }).filter((log) => log.args.roundId === roundId);
const read = (name) => decoded.filter((log) => log.eventName === name);
const openedLog = read("RoundOpened")[0];
if (!openedLog) throw new Error(`RoundOpened for round ${roundId} not found.`);
const stamp = async (log) => new Date((await blockTime(log.blockNumber)) * 1000).toISOString();
const link = (log) => `${explorerUrl}/tx/${log.transactionHash}`;
const seed = await publicClient.readContract({ address, abi: roundAbi, functionName: "protocolLiquiditySeed" });

const report = {
  round: Number(roundId),
  open: { tx: link(openedLog), at: await stamp(openedLog), tradingEnd: Number(round[1]), evaluationEnd: Number(round[2]), rMin: round[3].toString(), rMax: round[4].toString(), twapWindow: Number(round[5]), epsilon: round[6].toString() },
  status: { collapsed: round[9], settled: round[10], cancelled: round[13], winnerProposalId: Number(round[8]), realisedReturn: round[11].toString(), totalDeposited: usdc(round[12]) },
  proposals: read("ProposalCreated").map((log) => ({ id: Number(log.args.proposalId), proposer: log.args.proposer, tEthBps: log.args.tEthBps, rationale: log.args.rationaleURI, tx: link(log) })),
  collapsedTwaps: read("Collapsed")[0] ? read("Collapsed")[0].args.twaps.map((twap) => Number(twap) / 1e18) : null,
  deposits: read("Deposited").map((log) => ({ user: log.args.user, usdc: usdc(log.args.amount), tx: link(log) })),
  trades: read("Trade").map((log) => ({ proposalId: Number(log.args.proposalId), user: log.args.user, side: log.args.side, amountIn: log.args.amountIn.toString(), amountOut: log.args.amountOut.toString(), block: Number(log.blockNumber), tx: link(log) })),
  redemptions: read("Redeemed").map((log) => ({ user: log.args.user, usdc: usdc(log.args.payout), tx: link(log) })),
  bondRefunds: read("BondRefunded").map((log) => ({ proposalId: Number(log.args.proposalId), proposer: log.args.proposer, usdc: usdc(log.args.amount) })),
  reserveNow: usdc(seed),
};
const sum = (rows) => rows.reduce((total, row) => total + Number(row.usdc), 0);
report.totals = { deposited: sum(report.deposits), redeemed: sum(report.redemptions), bondsRefunded: sum(report.bondRefunds) };

console.log(JSON.stringify(report, null, 2));
