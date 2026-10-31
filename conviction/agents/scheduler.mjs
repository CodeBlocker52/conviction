export const PERIODIC_INTERVAL_SECONDS = 15;
export const FINAL_WINDOW_INTERVAL_SECONDS = 10;

export function nextAgentEvaluation(agent, round, chainTimestamp, previous = {}) {
  const tradingEnd = Number(round.tradingEnd);
  if (round.collapsed || round.settled || round.cancelled || chainTimestamp >= tradingEnd) return null;

  if (agent.type === "proposer") {
    if (previous.proposerEvaluated) return null;
    return { cadence: "early", nextState: { ...previous, proposerEvaluated: true } };
  }

  if (agent.type !== "forecaster") throw new Error(`Unsupported agent type: ${agent.type}`);
  const finalWindowStart = tradingEnd - 60;
  if (chainTimestamp >= finalWindowStart) {
    if (chainTimestamp - Number(previous.lastForecastAt ?? 0) >= FINAL_WINDOW_INTERVAL_SECONDS) {
      return {
        cadence: "final-window",
        nextState: { ...previous, finalWindowEvaluated: true, lastForecastAt: chainTimestamp },
      };
    }
    return null;
  }
  if (chainTimestamp - Number(previous.lastForecastAt ?? 0) >= PERIODIC_INTERVAL_SECONDS) {
    return {
      cadence: "periodic",
      nextState: { ...previous, lastForecastAt: chainTimestamp },
    };
  }
  return null;
}
