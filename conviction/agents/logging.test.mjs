import test from "node:test";
import assert from "node:assert/strict";
import { sumGasReservations } from "./logging.mjs";

test("daily gas counts the confirmed actual fee, holds pending estimates and releases unbroadcast ones", () => {
  const lines = [
    { type: "transaction_attempt", agentId: "MOMENTUM", reservationId: "a", estimatedGasWei: "10" },
    { type: "transaction", agentId: "MOMENTUM", reservationId: "a", actualGasWei: "15" },
    { type: "transaction_attempt", agentId: "MOMENTUM", reservationId: "b", estimatedGasWei: "20" },
    { type: "transaction_attempt", agentId: "NEWS", reservationId: "c", estimatedGasWei: "100" },
    { type: "transaction_attempt", agentId: "MOMENTUM", reservationId: "d", estimatedGasWei: "100" },
    { type: "transaction", agentId: "MOMENTUM", reservationId: "d", actualGasWei: "40" },
    { type: "transaction_attempt", agentId: "MOMENTUM", reservationId: "e", estimatedGasWei: "70" },
    { type: "transaction_released", agentId: "MOMENTUM", reservationId: "e" },
  ].map(JSON.stringify).join("\n");
  // a: actual 15, b: pending estimate 20, d: actual 40 (not the 100 estimate), e: released.
  assert.equal(sumGasReservations(lines, "MOMENTUM"), 75n);
});

test("gas ledger rejects malformed records instead of resetting the cap", () => {
  assert.throws(
    () => sumGasReservations('{"type":"transaction_attempt","agentId":"MOMENTUM","estimatedGasWei":"x"}', "MOMENTUM"),
    /invalid gas reservation/,
  );
  assert.throws(
    () => sumGasReservations("{", "MOMENTUM"),
    /invalid JSON/,
  );
});

test("per-round gas sums only reservations tagged with that round", () => {
  const lines = [
    { type: "transaction_attempt", agentId: "A", reservationId: "r1", roundId: "8", estimatedGasWei: "10" },
    { type: "transaction_attempt", agentId: "A", reservationId: "r2", roundId: "9", estimatedGasWei: "20" },
    { type: "transaction", agentId: "A", reservationId: "r1", actualGasWei: "4" },
    { type: "transaction_attempt", agentId: "B", reservationId: "r3", roundId: "8", estimatedGasWei: "99" },
  ].map((event) => JSON.stringify(event)).join("\n");
  assert.equal(sumGasReservations(lines, "A", "log", { roundId: "8" }), 4n);
  assert.equal(sumGasReservations(lines, "A", "log", { roundId: "9" }), 20n);
  assert.equal(sumGasReservations(lines, "A"), 24n);
});
