export function shouldWaitForNextRound(currentRound, startRound) {
  return startRound !== null && currentRound <= startRound;
}
