export function nextAgentEvaluation(agent, round, chainTimestamp, previous = {}) {
  const tradingEnd = Number(round.tradingEnd);
  if (round.settled || round.cancelled || chainTimestamp >= tradingEnd) return null;

  if (agent.type === "proposer") {
    if (previous.proposerEvaluated) return null;
    return { cadence: "early", nextState: { ...previous, proposerEvaluated: true } };
  }

  if (agent.type !== "forecaster") throw new Error(`Unsupported agent type: ${agent.type}`);
  const finalWindowStart = tradingEnd - 60;
  if (chainTimestamp >= finalWindowStart && !previous.finalWindowEvaluated) {
    return {
      cadence: "final-window",
      nextState: { ...previous, finalWindowEvaluated: true, lastForecastAt: chainTimestamp },
    };
  }
  if (chainTimestamp - Number(previous.lastForecastAt ?? 0) >= 15) {
    return {
      cadence: "periodic",
      nextState: { ...previous, lastForecastAt: chainTimestamp },
    };
  }
  return null;
}
