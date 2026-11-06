import { spawnSync } from "node:child_process";
import { KEEPER_LOCK_PATH } from "../contracts/script/round-open-guard.mjs";
import { agentRuntimeLockPath } from "../agents/runtime-lock.mjs";
import { inspectLock, launcherLock, stopPid } from "./demo-process.mjs";

const launcher = inspectLock(launcherLock, "demo-live.mjs", { clearStale: true });
if (launcher) {
  await stopPid(launcher, "launcher");
} else {
  await stopPid(inspectLock(KEEPER_LOCK_PATH, "keeper-run.mjs", { clearStale: true }), "keeper");
  await stopPid(inspectLock(agentRuntimeLockPath, "agents/run.mjs", { clearStale: true }), "agents");
  const result = spawnSync(process.execPath, ["--env-file=.env", "contracts/script/update-oracle.mjs", "stop"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Oracle watcher cleanup failed.");
}
