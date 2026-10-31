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

let activeGasRound = null;
export const setActiveGasRound = (roundId) => { activeGasRound = roundId === null || roundId === undefined ? null : String(roundId); };
export const getActiveGasRound = () => activeGasRound;

function readLogContents(day) {
  const path = resolve(logDirectory, `${day}.jsonl`);
  try {
    return { contents: readFileSync(path, "utf8"), path };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A round can straddle UTC midnight, so the per-round total reads today's and yesterday's logs.
export function readRoundGasReservations(agentId, roundId, now = new Date()) {
  const days = [0, 1].map((back) => new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10));
  let total = 0n;
  for (const day of days) {
    const log = readLogContents(day);
    if (log) total += sumGasReservations(log.contents, agentId, log.path, { roundId });
  }
  return total;
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

export function sumGasReservations(contents, agentId, path = "agent log", { roundId } = {}) {
  const reservations = new Map();
  const actualFees = new Map();
  const released = new Set();
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
      if (roundId === undefined || String(event.roundId) === String(roundId)) {
        reservations.set(event.reservationId ?? `line-${index}`, BigInt(event.estimatedGasWei));
      }
    }
    if (event.agentId === agentId && event.type === "transaction_released" && event.reservationId) {
      released.add(event.reservationId);
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
    if (released.has(reservationId)) continue;
    // A pending or unknown-outcome transaction holds its estimate; a confirmed one counts its actual fee.
    total += actualFees.get(reservationId) ?? estimate;
  }
  return total;
}
