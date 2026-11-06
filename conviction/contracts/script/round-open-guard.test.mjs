import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRoundCanBeOpened } from "./round-open-guard.mjs";

function makeTempLock(t) {
  const directory = mkdtempSync(join(tmpdir(), "wavefund-round-open-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "keeper.lock");
}

test("round opening is blocked while keeper:run holds its lock", async (t) => {
  const lockPath = makeTempLock(t);
  writeFileSync(lockPath, "1234");

  await assert.rejects(
    assertRoundCanBeOpened({
      roundCount: 0n,
      readRound: async () => { throw new Error("no rounds should be read"); },
      lockPath,
      processIsRunning: (pid) => pid === 1234,
    }),
    /keeper:run is already running \(PID 1234/,
  );
});

test("round opening is blocked by any unsettled round, not only the latest", async (t) => {
  const lockPath = makeTempLock(t);
  const readIds = [];
  await assert.rejects(
    assertRoundCanBeOpened({
      roundCount: 3n,
      lockPath,
      readRound: async (roundId) => {
        readIds.push(roundId);
        return roundId === 1n
          ? [0n, 0n, 0n, 0n, 0n, 0, 0n, 0n, 0n, false, false, 0n, 0n, false]
          : [0n, 0n, 0n, 0n, 0n, 0, 0n, 0n, 0n, false, true, 0n, 0n, false];
      },
    }),
    /Round 1 is not settled or cancelled/,
  );
  assert.deepEqual(readIds, [1n]);
});

test("round opening is allowed when all rounds are settled or cancelled and the keeper lock is stale", async (t) => {
  const lockPath = makeTempLock(t);
  writeFileSync(lockPath, "1234");
  const readIds = [];

  await assertRoundCanBeOpened({
    roundCount: 2n,
    lockPath,
    processIsRunning: () => false,
    readRound: async (roundId) => {
      readIds.push(roundId);
      return roundId === 1n
        ? [0n, 0n, 0n, 0n, 0n, 0, 0n, 0n, 0n, false, true, 0n, 0n, false]
        : [0n, 0n, 0n, 0n, 0n, 0, 0n, 0n, 0n, false, false, 0n, 0n, true];
    },
  });
  assert.deepEqual(readIds, [1n, 2n]);
});
