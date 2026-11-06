import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const agentRuntimeLockPath = fileURLToPath(new URL("./.runtime.lock", import.meta.url));

export function agentRuntimeIsRunning(path = agentRuntimeLockPath, checkProcess = process.kill) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const pid = Number(contents.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    checkProcess(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
