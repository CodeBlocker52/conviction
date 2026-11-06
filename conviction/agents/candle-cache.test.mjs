import test from "node:test";
import assert from "node:assert/strict";
import { createCandleCache } from "./candle-cache.mjs";

test("proposers reuse candles up to five minutes after a failed fetch, not beyond", async () => {
  let time = 0;
  let fail = false;
  let fallback;
  const candles = [[1, 2, 3]];
  const read = createCandleCache({
    now: () => time,
    fetchCandles: async () => { if (fail) throw new Error("Coinbase unavailable"); return candles; },
    onFallback: (event) => { fallback = event; },
  });
  assert.equal(await read({ maxFallbackAgeMs: 300_000 }), candles);
  fail = true;
  time = 300_000;
  assert.equal(await read({ maxFallbackAgeMs: 300_000 }), candles);
  assert.equal(fallback.ageMs, 300_000);
  time += 1;
  await assert.rejects(read({ maxFallbackAgeMs: 300_000 }), /Coinbase unavailable/);
});

test("fresh cached candles avoid an extra request", async () => {
  let calls = 0;
  let time = 0;
  const read = createCandleCache({ now: () => time, fetchCandles: async () => { calls += 1; return []; } });
  await read({ freshForMs: 120_000, maxFallbackAgeMs: 300_000 });
  time = 119_000;
  await read({ freshForMs: 120_000, maxFallbackAgeMs: 300_000 });
  assert.equal(calls, 1);
});
