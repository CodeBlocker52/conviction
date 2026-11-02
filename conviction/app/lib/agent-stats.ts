// Pure aggregation of QuantumRound events into per-agent stats. Everything here comes from on-chain events
// (read through the explorer's indexed logs), never from local agent log files.
export type EventLog = { name: string; params: Record<string, string>; blockNumber: number };

export type AgentEventStats = {
  /** Most recent on-chain rationale this address proposed, with its round (logs are newest first). */
  latestRationale: { roundId: number; tEthBps: number; text: string } | null;
  /** Trades by this address across all rounds (Guardian trades are its interventions). */
  trades: number;
  /** Rounds with a redemption: sum of payouts minus the matching deposits, in 6-decimal USDC units. */
  settledRounds: number;
  pnlUnits: bigint;
};

const same = (left: string | undefined, right: string) => left?.toLowerCase() === right.toLowerCase();

export function aggregateAgentEvents(logs: EventLog[], agentAddress: string): AgentEventStats {
  let latestRationale: AgentEventStats["latestRationale"] = null;
  let latestBlock = -1;
  let trades = 0;
  const deposits = new Map<string, bigint>();
  const redeemed = new Map<string, bigint>();

  for (const log of logs) {
    const { params } = log;
    if (log.name === "ProposalCreated" && same(params.proposer, agentAddress) && log.blockNumber > latestBlock) {
      latestBlock = log.blockNumber;
      latestRationale = { roundId: Number(params.roundId), tEthBps: Number(params.tEthBps), text: params.rationaleURI ?? "" };
    } else if (log.name === "Trade" && same(params.user, agentAddress)) {
      trades += 1;
    } else if (log.name === "Deposited" && same(params.user, agentAddress)) {
      deposits.set(params.roundId, (deposits.get(params.roundId) ?? 0n) + BigInt(params.amount));
    } else if (log.name === "Redeemed" && same(params.user, agentAddress)) {
      redeemed.set(params.roundId, (redeemed.get(params.roundId) ?? 0n) + BigInt(params.payout));
    }
  }

  let pnlUnits = 0n;
  for (const [roundId, payout] of redeemed) pnlUnits += payout - (deposits.get(roundId) ?? 0n);
  return { latestRationale, trades, settledRounds: redeemed.size, pnlUnits };
}
