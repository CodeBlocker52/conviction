import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateMeanReversionProposal,
  calculateMomentumProposal,
  calculateNewsFallback,
  calculateNewsProposal,
  findProposalDuplicate,
  parseRssHeadlines,
  resolveDistinctProposal,
  validateNewsModelResponse,
  NEWS_MODEL,
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
  assert.ok(positiveDecision.tEthBps <= 9_000);
  assert.ok(negativeDecision.tEthBps >= 1_000);
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
  assert.ok(bullish.tEthBps <= 9_000);
  assert.ok(bearish.tEthBps >= 1_000);
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

const statusQuo = { id: 0, tEthBps: 4_900, source: "status-quo" };

function applyAgents(decisions, existing) {
  const considered = [...existing];
  return decisions.map((decision) => {
    const result = resolveDistinctProposal(decision, considered);
    if (!result.skip) considered.push({ tEthBps: result.tEthBps });
    return result;
  });
}

test("three near-identical signals yield three distinct proposals away from the status quo", () => {
  const decisions = [
    { tEthBps: 4_100, direction: -1, rationale: "Momentum: z=-0.5; target 4100 bps tETH." },
    { tEthBps: 4_100, direction: 1, rationale: "Mean reversion: z=-0.5; target 4100 bps tETH." },
    { tEthBps: 4_200, direction: -1, rationale: "News: score; target 4200 bps tETH." },
  ];
  const results = applyAgents(decisions, [statusQuo]);
  const all = [statusQuo.tEthBps, ...results.map((result) => result.tEthBps)];
  assert.ok(results.every((result) => !result.skip));
  for (let left = 0; left < all.length; left += 1) {
    for (let right = left + 1; right < all.length; right += 1) {
      assert.ok(Math.abs(all[left] - all[right]) >= 500, `${all[left]} vs ${all[right]}`);
    }
  }
});

test("shift direction follows the agent's signal and the rationale states the shift", () => {
  const down = resolveDistinctProposal({ tEthBps: 4_900, direction: -1, rationale: "Momentum: z=-0.1; target 4900 bps tETH." }, [statusQuo]);
  const up = resolveDistinctProposal({ tEthBps: 4_900, direction: 1, rationale: "Mean reversion: z=-0.1; target 4900 bps tETH." }, [statusQuo]);
  assert.equal(down.tEthBps, 4_400);
  assert.equal(up.tEthBps, 5_400);
  assert.ok(down.shifted && up.shifted);
  assert.match(down.rationale, /Signal suggests 49%; shifted to 44% to stay distinct from existing proposals\./);
  assert.ok(up.rationale.length <= 280);
  const long = resolveDistinctProposal({ tEthBps: 4_900, direction: 1, rationale: "x".repeat(400) }, [statusQuo]);
  assert.ok(long.rationale.length <= 280);
  assert.match(long.rationale, /shifted to 54%/);
});

test("unshifted proposals are left alone", () => {
  const result = resolveDistinctProposal({ tEthBps: 2_000, direction: -1, rationale: "ok" }, [statusQuo]);
  assert.deepEqual([result.tEthBps, result.shifted, result.skip], [2_000, false, false]);
});

test("shifted allocations never leave the 1000-9000 bps bounds", () => {
  const edgeHigh = resolveDistinctProposal({ tEthBps: 9_000, direction: 1, rationale: "x" }, [{ tEthBps: 8_800 }]);
  assert.equal(edgeHigh.tEthBps, 8_300);
  const edgeLow = resolveDistinctProposal({ tEthBps: 1_000, direction: -1, rationale: "x" }, [{ tEthBps: 1_200 }]);
  assert.equal(edgeLow.tEthBps, 1_700);
  const outOfRange = resolveDistinctProposal({ tEthBps: 10_000, direction: 1, rationale: "x" }, [{ tEthBps: 5_000 }]);
  assert.equal(outOfRange.tEthBps, 9_000);
  for (const direction of [-1, 1]) {
    for (let bps = 0; bps <= 10_000; bps += 100) {
      const result = resolveDistinctProposal({ tEthBps: bps, direction, rationale: "x" }, [{ tEthBps: 5_000 }, { tEthBps: 3_000 }]);
      assert.ok(result.skip || (result.tEthBps >= 1_000 && result.tEthBps <= 9_000));
    }
  }
});

test("a proposal with no valid slot on either side is skipped with a reason", () => {
  const crowded = [1_000, 1_900, 2_800, 3_700, 4_600, 5_500, 6_400, 7_300, 8_200, 9_000].map((tEthBps) => ({ tEthBps }));
  const result = resolveDistinctProposal({ tEthBps: 5_000, direction: 1, rationale: "x" }, crowded);
  assert.equal(result.skip, true);
  assert.equal(result.tEthBps, null);
  assert.match(result.reason, /No allocation/);
});

test("opposite side is tried once when the signal direction is exhausted", () => {
  const result = resolveDistinctProposal({ tEthBps: 8_800, direction: 1, rationale: "x" }, [{ tEthBps: 8_700 }]);
  assert.equal(result.tEthBps, 8_200);
  assert.match(result.reason, /opposite side/);
});

const claudeReply = (text) => async (url, options) => {
  claudeReply.last = { url, body: JSON.parse(options.body), headers: options.headers };
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
};
const headlines = ["Ethereum ETF inflow accelerates as adoption grows"];

test("News uses claude-haiku-5-5 and accepts a valid mocked Claude response", async () => {
  const valid = JSON.stringify({ tEthBps: 6_300, rationale: "Positive ETF flow headlines support higher ETH exposure." });
  const decision = await calculateNewsProposal({ headlines, marketSignal: { zScore: 0.4 }, apiKey: "test-key", fetchImpl: claudeReply(valid) });
  assert.equal(NEWS_MODEL, "claude-haiku-5-5");
  assert.equal(claudeReply.last.body.model, "claude-haiku-5-5");
  assert.equal(decision.source, "claude");
  assert.equal(decision.fallbackReason, null);
  assert.equal(decision.tEthBps, 6_300);
});

test("invalid mocked Claude responses fall back with an explicit reason", async () => {
  for (const bad of ["not json", JSON.stringify({ tEthBps: 5_000 }), JSON.stringify({ tEthBps: 5_000.5, rationale: "x".repeat(40) }), JSON.stringify({ tEthBps: 5_000, rationale: "short" }), JSON.stringify({ tEthBps: 5_000, rationale: "x".repeat(40), extra: 1 })]) {
    assert.throws(() => validateNewsModelResponse(bad));
    const decision = await calculateNewsProposal({ headlines, apiKey: "test-key", fetchImpl: claudeReply(bad) });
    assert.equal(decision.source, "fallback");
    assert.match(decision.fallbackReason, /Claude call or validation failed/);
  }
  const failing = async () => ({ ok: false, status: 500 });
  const http = await calculateNewsProposal({ headlines, apiKey: "test-key", fetchImpl: failing });
  assert.match(http.fallbackReason, /HTTP 500/);
});

test("out-of-range Claude allocations are clamped to the hard bounds", () => {
  const result = validateNewsModelResponse(JSON.stringify({ tEthBps: 10_000, rationale: "Extremely bullish headline flow today." }));
  assert.equal(result.tEthBps, 9_000);
});

test("News without a key reports the fallback and why", async () => {
  const decision = await calculateNewsProposal({ headlines, apiKey: undefined });
  assert.equal(decision.source, "fallback");
  assert.match(decision.fallbackReason, /ANTHROPIC_API_KEY is not set/);
});
