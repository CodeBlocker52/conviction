const MIN_CANDLES = 30;
const CANDLE_SECONDS = 60;
const MIN_BAND_BPS = 50;
const MAX_BAND_BPS = 200;
const BAND_STEP_BPS = 50;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Retries transient Coinbase failures (stale or missing candles, HTTP errors) with backoff:
// 3 attempts over roughly 20 seconds by default.
export async function fetchRecentEthCandles({ attempts = 3, delaysMs = [8_000, 12_000], fetchOnce = fetchRecentEthCandlesOnce, wait = sleep } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchOnce();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(delaysMs[Math.min(attempt, delaysMs.length - 1)]);
    }
  }
  throw new Error(`Coinbase candles unavailable after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`);
}

async function fetchRecentEthCandlesOnce() {
  const response = await fetch(
    "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60",
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Coinbase candles request failed: HTTP ${response.status}`);
  const candles = await response.json();
  if (!Array.isArray(candles)) throw new Error("Coinbase returned an invalid candle response.");

  const currentTime = Math.floor(Date.now() / 1000);
  const timestamps = candles.map((candle) => Number(candle?.[0])).filter(Number.isFinite);
  const newestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : Number.NaN;
  if (!Number.isFinite(newestTimestamp) || currentTime - newestTimestamp > 300 || newestTimestamp > currentTime) {
    throw new Error("Coinbase one-minute candles are missing or stale.");
  }
  return candles;
}

function logReturns(candles) {
  const closes = candles
    .map((candle) => ({ timestamp: Number(candle?.[0]), close: Number(candle?.[4]) }))
    .filter(({ timestamp, close }) => Number.isInteger(timestamp) && Number.isFinite(close) && close > 0)
    .sort((left, right) => left.timestamp - right.timestamp);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (current.timestamp - previous.timestamp !== CANDLE_SECONDS) continue;
    returns.push(Math.log(current.close / previous.close));
  }
  if (returns.length < MIN_CANDLES) {
    throw new Error(`At least ${MIN_CANDLES + 1} contiguous one-minute closes are required.`);
  }
  return returns;
}

export function calculateRiskModel(candles, horizonSeconds = 600) {
  if (!Number.isInteger(horizonSeconds) || horizonSeconds < CANDLE_SECONDS) {
    throw new Error("Evaluation horizon must be at least 60 whole seconds.");
  }
  const returns = logReturns(candles);
  const meanLogReturnPerMinute = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variancePerMinute = returns.reduce(
    (sum, value) => sum + (value - meanLogReturnPerMinute) ** 2,
    0,
  ) / (returns.length - 1);
  const sigmaLogReturnPerMinute = Math.sqrt(variancePerMinute);
  const horizonMinutes = horizonSeconds / CANDLE_SECONDS;
  const horizonVolatility = sigmaLogReturnPerMinute * Math.sqrt(horizonMinutes);
  const rawBandBps = 3 * horizonVolatility * 10_000;
  const boundedBandBps = Math.min(MAX_BAND_BPS, Math.max(MIN_BAND_BPS, rawBandBps));
  const bandBps = Math.min(
    MAX_BAND_BPS,
    Math.max(MIN_BAND_BPS, Math.round(boundedBandBps / BAND_STEP_BPS) * BAND_STEP_BPS),
  );

  return {
    horizonSeconds,
    sampleCount: returns.length,
    meanLogReturnPerMinute,
    sigmaLogReturnPerMinute,
    horizonVolatility,
    rawBandBps,
    bandBps,
    rMin: BigInt(10_000 - bandBps) * 100_000_000_000_000n,
    rMax: BigInt(10_000 + bandBps) * 100_000_000_000_000n,
  };
}

export function estimateQuantFairProbability({
  tEthBps,
  rMin,
  rMax,
  horizonSeconds,
  meanLogReturnPerMinute,
  sigmaLogReturnPerMinute,
  driftShrink = 0.5,
  maxDriftBandFraction = 0.25,
}) {
  if (!Number.isInteger(tEthBps) || tEthBps < 0 || tEthBps > 10_000) {
    throw new Error("tETH allocation must be between 0 and 10000 bps.");
  }
  if (typeof rMin !== "bigint" || typeof rMax !== "bigint" || rMax <= rMin) {
    throw new Error("Risk bounds must be increasing bigint ratios.");
  }
  if (!Number.isInteger(horizonSeconds) || horizonSeconds < CANDLE_SECONDS) {
    throw new Error("Evaluation horizon must be at least 60 whole seconds.");
  }
  if (!Number.isFinite(meanLogReturnPerMinute) || !Number.isFinite(sigmaLogReturnPerMinute) || sigmaLogReturnPerMinute < 0) {
    throw new Error("Drift and volatility must be finite, and volatility cannot be negative.");
  }
  if (!Number.isFinite(driftShrink) || driftShrink < 0 || driftShrink > 1) {
    throw new Error("Drift shrink must be between zero and one.");
  }
  if (!Number.isFinite(maxDriftBandFraction) || maxDriftBandFraction < 0 || maxDriftBandFraction > 1) {
    throw new Error("Drift cap fraction must be between zero and one.");
  }

  const horizonMinutes = horizonSeconds / CANDLE_SECONDS;
  const horizonVolatility = sigmaLogReturnPerMinute * Math.sqrt(horizonMinutes);
  const maxAbsoluteDrift = 3 * horizonVolatility * maxDriftBandFraction;
  const shrunkDrift = meanLogReturnPerMinute * horizonMinutes * driftShrink;
  const boundedDrift = Math.min(maxAbsoluteDrift, Math.max(-maxAbsoluteDrift, shrunkDrift));
  const allocation = tEthBps / 10_000;
  const expectedPortfolioReturn = allocation
    * (Math.exp(boundedDrift + 0.5 * horizonVolatility ** 2) - 1);
  const lower = Number(rMin) / 1e18;
  const upper = Number(rMax) / 1e18;
  if (upper <= lower) throw new Error("Risk bounds are too close to estimate a fair probability.");
  const probability = (1 + expectedPortfolioReturn - lower) / (upper - lower);

  return {
    probability: Math.min(1, Math.max(0, probability)),
    expectedPortfolioReturn,
    appliedDrift: boundedDrift,
    maxAbsoluteDrift,
  };
}
