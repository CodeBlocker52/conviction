import assert from "node:assert/strict";
import test from "node:test";
import { create429RetryFetch } from "./rpc.mjs";

test("primary 429 errors retry with backoff before succeeding", async () => {
  const delays = [];
  let calls = 0;
  const fetchWithRetry = create429RetryFetch("primary", "", {
    fetchImpl: async () => new Response(null, { status: ++calls < 3 ? 429 : 200 }),
    sleep: async (delay) => delays.push(delay), warn: () => {},
  });
  assert.equal((await fetchWithRetry("", {})).status, 200);
  assert.deepEqual(delays, [2_000, 4_000]);
});

test("a fallback is used only after primary retries are exhausted", async () => {
  const calls = [];
  const delays = [];
  const fetchWithRetry = create429RetryFetch("primary", "fallback", {
    fetchImpl: async (url) => { calls.push(url); return new Response(null, { status: url === "primary" ? 429 : 200 }); },
    sleep: async (delay) => delays.push(delay), warn: () => {},
  });
  assert.equal((await fetchWithRetry("", {})).status, 200);
  assert.equal(calls.filter((url) => url === "primary").length, 6);
  assert.equal(calls.at(-1), "fallback");
  assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 32_000]);
});

test("repeated 429 responses without a fallback fail explicitly", async () => {
  const fetchWithRetry = create429RetryFetch("primary", "", {
    fetchImpl: async () => new Response(null, { status: 429 }),
    sleep: async () => {}, warn: () => {},
  });
  await assert.rejects(fetchWithRetry("", {}), /no distinct fallback/);
});

test("aborted requests stop before retrying instead of reusing an expired signal", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchWithRetry = create429RetryFetch("primary", "fallback", {
    fetchImpl: async () => { calls += 1; return new Response(null, { status: 429 }); },
    sleep: async () => controller.abort(), warn: () => {},
  });
  await assert.rejects(fetchWithRetry("", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("concurrent Arc requests are serialized", async () => {
  let active = 0;
  let peak = 0;
  const fetchWithRetry = create429RetryFetch("primary", "", {
    fetchImpl: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(null, { status: 200 });
    }, warn: () => {},
  });
  await Promise.all([fetchWithRetry("", {}), fetchWithRetry("", {}), fetchWithRetry("", {})]);
  assert.equal(peak, 1);
});
