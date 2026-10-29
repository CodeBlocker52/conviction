import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const logDirectory = fileURLToPath(new URL("./logs/", import.meta.url));

export function writeAgentEvent(event) {
  const timestamp = new Date().toISOString();
  const logPath = resolve(logDirectory, `${timestamp.slice(0, 10)}.jsonl`);
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  appendFileSync(logPath, `${JSON.stringify({ timestamp, ...event })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify(event));
}

export function readDailyGasReservations(agentId, day = new Date().toISOString().slice(0, 10)) {
  const path = resolve(logDirectory, `${day}.jsonl`);
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return 0n;
    throw error;
  }
  return sumGasReservations(contents, agentId, path);
}

export function sumGasReservations(contents, agentId, path = "agent log") {
  const reservations = new Map();
  const actualFees = new Map();
  for (const [index, line] of contents.split("\n").entries()) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Agent log ${path} has invalid JSON on line ${index + 1}.`);
    }
    if (event.agentId === agentId && event.type === "transaction_attempt") {
      if (typeof event.estimatedGasWei !== "string" || !/^\d+$/.test(event.estimatedGasWei)) {
        throw new Error(`Agent log ${path} has an invalid gas reservation on line ${index + 1}.`);
      }
      reservations.set(event.reservationId ?? `line-${index}`, BigInt(event.estimatedGasWei));
    }
    if (event.agentId === agentId && event.type === "transaction" && event.reservationId) {
      if (typeof event.actualGasWei !== "string" || !/^\d+$/.test(event.actualGasWei)) {
        throw new Error(`Agent log ${path} has an invalid actual gas fee on line ${index + 1}.`);
      }
      actualFees.set(event.reservationId, BigInt(event.actualGasWei));
    }
  }
  let total = 0n;
  for (const [reservationId, estimate] of reservations) {
    const actual = actualFees.get(reservationId) ?? estimate;
    total += actual > estimate ? actual : estimate;
  }
  return total;
}
