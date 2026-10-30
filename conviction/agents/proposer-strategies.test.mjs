import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateMeanReversionProposal,
  calculateMomentumProposal,
  calculateNewsFallback,
  calculateNewsProposal,
  findProposalDuplicate,
  parseRssHeadlines,
} from "./proposer-strategies.mjs";

function candlesFromReturns(returns, initialPrice = 2_500) {
  const candles = [];
  let close = initialPrice;
  for (let index = 0; index <= returns.length; index += 1) {
    candles.push([1_800_000_000 + index * 60, close, close, close, close, 1]);
    if (index < returns.length) close *= Math.exp(returns[index]);
  }
  return candles;
}

test("momentum proposer follows bounded positive and negative 10-minute trends", () => {
  const positive = candlesFromReturns(Array.from({ length: 40 }, (_, index) =>
    0.0002 + (index % 2 === 0 ? 0.0001 : -0.0001),
  ));
  const negative = candlesFromReturns(Array.from({ length: 40 }, (_, index) =>
    -0.0002 + (index % 2 === 0 ? 0.0001 : -0.0001),
  ));
  const positiveDecision = calculateMomentumProposal(positive);
  const negativeDecision = calculateMomentumProposal(negative);
  assert.ok(positiveDecision.tEthBps > 5_000);
  assert.ok(negativeDecision.tEthBps < 5_000);
  assert.ok(positiveDecision.tEthBps <= 8_000);
  assert.ok(negativeDecision.tEthBps >= 2_000);
});

test("mean-reversion proposer reduces exposure after a positive price deviation", () => {
  const returns = Array.from({ length: 40 }, (_, index) =>
    index < 39 ? (index % 2 === 0 ? 0.0002 : -0.0002) : 0.02,
  );
  const decision = calculateMeanReversionProposal(candlesFromReturns(returns));
  assert.ok(decision.tEthBps < 5_000);
  assert.match(decision.rationale, /Mean reversion/);
});

test("proposer calculations reject malformed or gapped candles", () => {
  assert.throws(() => calculateMomentumProposal([]), /valid one-minute closes/);
  const candles = candlesFromReturns(Array(40).fill(0.001));
  candles[20][0] += 30;
  assert.throws(() => calculateMeanReversionProposal(candles), /contiguous one-minute candles/);
});

test("RSS parsing keeps recent titles, decodes entities, and drops stale items", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const xml = `
    <rss><channel>
      <item><title><![CDATA[ETH &amp; adoption grows]]></title><pubDate>Fri, 30 Oct 2026 11:00:00 GMT</pubDate></item>
      <item><title>Old exploit</title><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
  assert.deepEqual(parseRssHeadlines(xml, now), ["ETH & adoption grows"]);
  assert.throws(() => parseRssHeadlines("x".repeat(500_001)), /size limit/);
});

test("news fallback is deterministic, bounded, and reports empty-source fallback", () => {
  const bullish = calculateNewsFallback(["Ethereum adoption and ETF inflow accelerate."]);
  const bearish = calculateNewsFallback(["Ethereum suffers a major hack and outage."]);
  const empty = calculateNewsFallback([]);
  assert.ok(bullish.tEthBps > 5_000);
  assert.ok(bearish.tEthBps < 5_000);
  assert.equal(empty.tEthBps, 5_000);
  assert.equal(empty.source, "fallback");
  assert.ok(bullish.tEthBps <= 8_000);
  assert.ok(bearish.tEthBps >= 2_000);
});

test("news price-only fallback uses market drift and includes its input signal", () => {
  const decision = calculateNewsFallback([], { zScore: 1.5, currentPrice: 2_500 });
  assert.ok(decision.tEthBps > 5_000);
  assert.equal(decision.signal.currentPrice, 2_500);
  assert.equal(decision.signal.headlineCount, 0);
  assert.match(decision.rationale, /price-only fallback/);
});

test("duplicate detection uses the inclusive 500-bps proposal threshold", () => {
  const existing = [{ id: 0, tEthBps: 5_000, source: "status-quo" }];
  assert.equal(findProposalDuplicate(5_500, existing), existing[0]);
  assert.equal(findProposalDuplicate(5_501, existing), null);
  assert.throws(() => findProposalDuplicate(10_001, existing), /between 0 and 10000/);
});

test("news model accepts only the strict decision schema and falls back on invalid output", async () => {
  const headlines = ["Ethereum institutions expand exposure."];
  const marketSignal = { currentPrice: 2_500, zScore: 0.8 };
  const valid = await calculateNewsProposal({
    headlines,
    marketSignal,
    apiKey: "test-key",
    fetchImpl: async (_url, request) => {
      assert.deepEqual(JSON.parse(request.body).messages[0].content, JSON.stringify({ headlines, marketSignal }));
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: JSON.stringify({
            tEthBps: 6_500,
            rationale: "Positive adoption coverage supports a measured increase.",
          }) }],
        }),
      };
    },
  });
  assert.equal(valid.tEthBps, 6_500);
  assert.equal(valid.source, "claude");
  assert.deepEqual(valid.signal, {
    headlineCount: 1,
    headlines,
    currentPrice: marketSignal.currentPrice,
    trendZScore: marketSignal.zScore,
  });

  const invalid = await calculateNewsProposal({
    headlines,
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "not json" }] }),
    }),
  });
  assert.equal(invalid.source, "fallback");
  assert.match(invalid.fallbackReason, /valid JSON/);
});
