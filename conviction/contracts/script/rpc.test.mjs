import assert from "node:assert/strict";
import test from "node:test";
import { create429RetryFetch, withRpcAffinity } from "./rpc.mjs";

const read = { body: JSON.stringify({ method: "eth_blockNumber" }) };
test("rotates immediately on 429, prefers success and retries primary after cooldown", async () => {
  let time = 0;
  const calls = [];
  const fetch = create429RetryFetch("primary", "second,third", {
    now: () => time, cooldownMs: 100, warn: () => {},
    fetchImpl: async (url) => { calls.push(url); return new Response(null, { status: url === "primary" && time < 100 ? 429 : 200 }); },
  });
  await fetch("", read);
  await fetch("", read);
  time = 100;
  await fetch("", read);
  assert.deepEqual(calls, ["primary", "second", "second", "primary"]);
});

test("read timeouts rotate but ambiguous broadcast timeouts do not", async () => {
  const calls = [];
  const fetch = create429RetryFetch("primary", "secondary", {
    warn: () => {},
    fetchImpl: async (url) => { calls.push(url); if (url === "primary") throw new DOMException("timed out", "TimeoutError"); return new Response(null, { status: 200 }); },
  });
  await fetch("", read);
  assert.deepEqual(calls, ["primary", "secondary"]);
  const broadcast = create429RetryFetch("primary", "secondary", {
    warn: () => {},
    fetchImpl: async (url) => { calls.push(url); throw new DOMException("timed out", "TimeoutError"); },
  });
  await assert.rejects(broadcast("", { body: JSON.stringify({ method: "eth_sendRawTransaction" }) }), /timed out/);
  assert.equal(calls.at(-1), "primary");
});

test("all limited endpoints back off and fail explicitly", async () => {
  const delays = [];
  const fetch = create429RetryFetch("primary", "second", {
    warn: () => {}, sleep: async (delay) => delays.push(delay),
    fetchImpl: async () => new Response(null, { status: 429 }),
  });
  await assert.rejects(fetch("", read), /unavailable/);
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 32000]);
});

test("authorization errors rotate without exposing URLs", async () => {
  const warnings = [];
  const fetch = create429RetryFetch("primary-secret", "fallback-secret", {
    warn: (line) => warnings.push(line),
    fetchImpl: async (url) => new Response(null, { status: url === "primary-secret" ? 401 : 200 }),
  });
  assert.equal((await fetch("", read)).status, 200);
  assert.ok(warnings.every((line) => !line.includes("secret")));
});

test("transaction affinity pins reads and broadcast to the same endpoint", async () => {
  const calls = [];
  const fetch = create429RetryFetch("primary", "secondary", {
    warn: () => {},
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(null, { status: url === "primary" ? 401 : 200 });
    },
  });
  await withRpcAffinity(async () => {
    await fetch("", read);
    await fetch("", { body: JSON.stringify({ method: "eth_sendRawTransaction" }) });
  });
  assert.deepEqual(calls, ["primary", "secondary", "secondary"]);
});
