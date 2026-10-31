import { parseUnits } from "viem";

export const PER_AGENT_GAS_CAP_WEI = parseUnits("0.25", 18);
export const PROPOSER_BOND_CAP_USDC = 1_000_000n;
export const FORECASTER_DEPOSIT_CAP_USDC = 2_000_000n;
export const TRADE_CAP_USDC = 1_000_000n;
export const MAX_PROPOSALS_PER_ROUND = 10;

export function requiredProtocolSeed(perProposal, proposerCount) {
  if (typeof perProposal !== "bigint" || perProposal < 0n) {
    throw new Error("Per-proposal seed must be a nonnegative bigint.");
  }
  if (!Number.isInteger(proposerCount) || proposerCount < 0) {
    throw new Error("Proposer count must be a nonnegative whole number.");
  }
  return perProposal * BigInt(1 + proposerCount);
}

export function assertGasWithinCap(spentWei, estimatedWei, capWei = PER_AGENT_GAS_CAP_WEI) {
  if (spentWei < 0n || estimatedWei < 0n || capWei < 0n) {
    throw new Error("Gas budget values must be nonnegative.");
  }
  if (spentWei + estimatedWei > capWei) {
    throw new Error("Estimated transaction fee would exceed this agent's 0.25 USDC gas cap.");
  }
}

export function assertPrincipalWithinCap(kind, amountUsdc) {
  if (amountUsdc < 0n) throw new Error("Principal amount must be nonnegative.");
  const cap = kind === "proposer"
    ? PROPOSER_BOND_CAP_USDC
    : kind === "forecaster"
      ? FORECASTER_DEPOSIT_CAP_USDC
      : null;
  if (cap === null) throw new Error(`Unsupported principal type: ${kind}.`);
  if (amountUsdc > cap) throw new Error(`${kind} principal exceeds the approved ${kind === "proposer" ? 1 : 2} USDC cap.`);
}

export function assertTradeWithinCap(amountUsdc) {
  if (amountUsdc < 0n || amountUsdc > TRADE_CAP_USDC) {
    throw new Error("Trade amount must be between zero and the 1 credit per-trade cap.");
  }
}

export function assertProposalCountWithinCap(count) {
  if (!Number.isInteger(count) || count < 0 || count > MAX_PROPOSALS_PER_ROUND) {
    throw new Error(`Proposal count must be between zero and ${MAX_PROPOSALS_PER_ROUND}.`);
  }
}
