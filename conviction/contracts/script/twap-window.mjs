export const MIN_TWAP_WINDOW_SECONDS = 300;
export const TWAP_WINDOW_FRACTION = 0.5;

// Default: 50% of the trading window, never below 300 s (20 min -> 600 s), and never above the trading window
// itself, which the contract forbids (a 4 min round gets 240 s).
export function defaultTwapWindow(tradingSeconds) {
  return Math.min(tradingSeconds, Math.max(MIN_TWAP_WINDOW_SECONDS, Math.floor(tradingSeconds * TWAP_WINDOW_FRACTION)));
}

// Mirrors QuantumRound.openRound: nonzero and no longer than the trading window.
export function resolveTwapWindow(requested, tradingSeconds) {
  const twapWindow = requested === undefined || requested === null ? defaultTwapWindow(tradingSeconds) : Number(requested);
  if (!Number.isInteger(twapWindow) || twapWindow <= 0 || twapWindow > 0xffffffff) {
    throw new Error("--twap-window must be a positive whole number of seconds.");
  }
  if (twapWindow > tradingSeconds) {
    throw new Error(`--twap-window (${twapWindow}s) cannot exceed the trading window (${tradingSeconds}s).`);
  }
  return twapWindow;
}

export function parseTwapWindowArg(args) {
  const index = args.indexOf("--twap-window");
  return index === -1 ? undefined : args[index + 1];
}
