export const PERIODIC_INTERVAL_SECONDS = 15;
export const FINAL_WINDOW_INTERVAL_SECONDS = 5;

export function nextAgentEvaluation(agent, round, chainTimestamp, previous = {}, intervals = {}) {
  const tradingEnd = Number(round.tradingEnd);
  if (round.collapsed || round.settled || round.cancelled) return null;

  if (agent.type === "proposer") {
    if (previous.proposerEvaluated) return null;
    const proposalCutoff = tradingEnd - Number(round.twapWindow);
    if (chainTimestamp >= proposalCutoff) {
      return {
        cadence: "missed-window",
        nextState: { ...previous, proposerEvaluated: true },
      };
    }
    if (chainTimestamp >= tradingEnd) return null;
    return { cadence: "early", nextState: { ...previous, proposerEvaluated: true } };
  }
  if (chainTimestamp >= tradingEnd) return null;

  if (agent.type !== "forecaster") throw new Error(`Unsupported agent type: ${agent.type}`);
  const twapWindow = Number(round.twapWindow);
  if (!Number.isFinite(twapWindow) || twapWindow <= 0) throw new Error("Round twapWindow is required to schedule forecasters.");
  const finalWindowStart = tradingEnd - twapWindow;
  const finalInterval = agent.name === "Guardian"
    ? intervals.guardianFinalSeconds ?? FINAL_WINDOW_INTERVAL_SECONDS
    : intervals.quantFinalSeconds ?? FINAL_WINDOW_INTERVAL_SECONDS;
  if (chainTimestamp >= finalWindowStart) {
    if (chainTimestamp - Number(previous.lastForecastAt ?? 0) >= finalInterval) {
      return {
        cadence: "final-window",
        nextState: { ...previous, finalWindowEvaluated: true, lastForecastAt: chainTimestamp },
      };
    }
    return null;
  }
  if (chainTimestamp - Number(previous.lastForecastAt ?? 0) >= (intervals.periodicSeconds ?? PERIODIC_INTERVAL_SECONDS)) {
    return {
      cadence: "periodic",
      nextState: { ...previous, lastForecastAt: chainTimestamp },
    };
  }
  return null;
}
