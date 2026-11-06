import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const KEEPER_LOCK_PATH = join(tmpdir(), "wavefund-keeper.lock");

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

export async function assertRoundCanBeOpened({
  roundCount,
  readRound,
  lockPath = KEEPER_LOCK_PATH,
  processIsRunning = isProcessRunning,
}) {
  let contents;
  try {
    contents = readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (contents !== undefined) {
    const pid = Number(contents.trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`Keeper lock ${lockPath} does not contain a valid PID; inspect it before opening a round.`);
    }
    if (processIsRunning(pid)) {
      throw new Error(`keeper:run is already running (PID ${pid}, lock ${lockPath}); it opens rounds automatically.`);
    }
  }

  for (let roundId = 1n; roundId <= roundCount; roundId += 1n) {
    const round = await readRound(roundId);
    if (!round[10] && !round[13]) {
      throw new Error(`Round ${roundId} is not settled or cancelled; finish it before opening another round.`);
    }
  }
}
