import assert from "node:assert/strict";
import test from "node:test";
import { create429RetryFetch } from "./rpc.mjs";

test("429 retry uses the configured exponential backoff before succeeding", async () => {
  const delays = [];
  let calls = 0;
  const fetchWithRetry = create429RetryFetch("https://primary.example", "", {
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: calls < 3 ? 429 : 200 });
    },
    sleep: async (delay) => delays.push(delay),
    warn: () => {},
  });

  const response = await fetchWithRetry("ignored", {});
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2_000, 4_000]);
});

test("repeated primary 429 responses switch to the fallback after all backoff delays", async () => {
  const delays = [];
  const requests = [];
  const fetchWithRetry = create429RetryFetch("https://primary.example", "https://fallback.example", {
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(null, { status: url.includes("primary") ? 429 : 200 });
    },
    sleep: async (delay) => delays.push(delay),
    warn: () => {},
  });

  const response = await fetchWithRetry("ignored", {});
  assert.equal(response.status, 200);
  assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 32_000]);
  assert.equal(requests.filter((url) => url.includes("primary")).length, 6);
  assert.equal(requests.at(-1), "https://fallback.example");
});

test("repeated 429 responses fail explicitly when no fallback is configured", async () => {
  const delays = [];
  const fetchWithRetry = create429RetryFetch("https://primary.example", "", {
    fetchImpl: async () => new Response(null, { status: 429 }),
    sleep: async (delay) => delays.push(delay),
    warn: () => {},
  });

  await assert.rejects(fetchWithRetry("ignored", {}), /no distinct fallback RPC is configured/);
  assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 32_000]);
});

test("concurrent Arc requests are serialized", async () => {
  let activeRequests = 0;
  let peakRequests = 0;
  const fetchWithRetry = create429RetryFetch("https://primary.example", "", {
    fetchImpl: async () => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return new Response(null, { status: 200 });
    },
    warn: () => {},
  });

  await Promise.all([fetchWithRetry("ignored", {}), fetchWithRetry("ignored", {}), fetchWithRetry("ignored", {})]);
  assert.equal(peakRequests, 1);
});
