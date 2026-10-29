import test from "node:test";
import assert from "node:assert/strict";
import { sumGasReservations } from "./logging.mjs";

test("daily gas reservations count the greater of estimate or actual and retain unknown outcomes", () => {
  const lines = [
    { type: "transaction_attempt", agentId: "MOMENTUM", reservationId: "a", estimatedGasWei: "10" },
    { type: "transaction", agentId: "MOMENTUM", reservationId: "a", actualGasWei: "15" },
    { type: "transaction_attempt", agentId: "MOMENTUM", reservationId: "b", estimatedGasWei: "20" },
    { type: "transaction_attempt", agentId: "NEWS", reservationId: "c", estimatedGasWei: "100" },
  ].map(JSON.stringify).join("\n");
  assert.equal(sumGasReservations(lines, "MOMENTUM"), 35n);
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
