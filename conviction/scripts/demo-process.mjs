import { readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const launcherLock = fileURLToPath(new URL("../logs/demo-live.lock", import.meta.url));

export function inspectLock(path, expected, { clearStale = false } = {}) {
  let contents;
  try { contents = readFileSync(path, "utf8").trim(); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const pid = Number(contents);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid PID in ${path}; inspect it manually.`);
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code !== "ESRCH") throw error;
    if (clearStale) unlinkSync(path);
    console.log(`Stale ${expected} lock for PID ${pid}${clearStale ? " cleared" : ""}.`);
    return null;
  }
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
  if (!command.includes(expected)) throw new Error(`PID ${pid} in ${path} is not ${expected}; refusing to signal it.`);
  return pid;
}

export async function stopPid(pid, name) {
  if (!pid) return;
  console.log(`Stopping ${name} (PID ${pid}).`);
  try { process.kill(pid, "SIGINT"); } catch (error) { if (error.code === "ESRCH") return; throw error; }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${name} PID ${pid} did not stop; inspect it before removing its lock.`);
}
