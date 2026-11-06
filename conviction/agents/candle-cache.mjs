export function createCandleCache({ fetchCandles, now = Date.now, onFallback = () => {} }) {
  let lastGood = null;
  return async ({ freshForMs = 0, maxFallbackAgeMs }) => {
    if (lastGood && now() - lastGood.at <= freshForMs) return lastGood.candles;
    try {
      const candles = await fetchCandles();
      lastGood = { candles, at: now() };
      return candles;
    } catch (error) {
      if (lastGood && now() - lastGood.at <= maxFallbackAgeMs) {
        onFallback({ error, ageMs: now() - lastGood.at });
        return lastGood.candles;
      }
      throw error;
    }
  };
}
