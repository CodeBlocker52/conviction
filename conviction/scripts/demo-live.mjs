import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { parseAbi } from "viem";
import { deployment, oracleAbi, publicClient, roundAbi } from "../contracts/script/demo-round-common.mjs";
import { KEEPER_LOCK_PATH } from "../contracts/script/round-open-guard.mjs";
import { agentRuntimeLockPath } from "../agents/runtime-lock.mjs";
import { readAgents } from "../agents/config.mjs";
import { inspectLock, launcherLock, stopPid } from "./demo-process.mjs";

const args = process.argv.slice(2);
const presetIndex = args.indexOf("--preset");
const preset = args[presetIndex + 1];
const oneRound = args.includes("--one-round");
if (presetIndex < 0 || !["judge", "demo3", "full"].includes(preset) || args.some((arg, index) => !["--preset", preset, "--one-round"].includes(arg) || (arg === preset && index !== presetIndex + 1))) {
  throw new Error("Usage: npm run demo:live -- --preset judge|demo3|full [--one-round]");
}
mkdirSync("logs", { recursive: true, mode: 0o700 });
for (const [path, name] of [[launcherLock, "demo-live.mjs"], [KEEPER_LOCK_PATH, "keeper-run.mjs"], [agentRuntimeLockPath, "agents/run.mjs"]]) {
  const pid = inspectLock(path, name, { clearStale: true });
  if (pid) throw new Error(`${name} is already running (PID ${pid}).`);
  console.log(`No running ${name}.`);
}
const fd = openSync(launcherLock, "wx", 0o600);
writeFileSync(fd, String(process.pid));
closeSync(fd);
let agents;
let keeper;
let shuttingDown = false;
let statusTimer;
let summaries = 0;
const logFiles = [];
const privateValues = [
  process.env.ARC_RPC_URL,
  process.env.ARC_TESTNET_RPC,
  process.env.CIRCLE_API_KEY,
  process.env.CIRCLE_ENTITY_SECRET,
  process.env.DEPLOYER_PK,
  process.env.KEEPER_PK,
  process.env.ANTHROPIC_API_KEY,
  ...(process.env.ARC_TESTNET_RPC_FALLBACK ?? "").split(","),
].filter((value) => value && value.length >= 12);
const redact = (line) => privateValues.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), line);
const stop = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(statusTimer);
  try {
    if (keeper && keeper.exitCode === null && keeper.signalCode === null) await stopPid(keeper.pid, "keeper");
    if (agents && agents.exitCode === null && agents.signalCode === null) await stopPid(agents.pid, "agents");
    const watcher = spawn(process.execPath, ["--env-file=.env", "contracts/script/update-oracle.mjs", "stop"], { stdio: "inherit" });
    const [code] = await once(watcher, "exit");
    if (code !== 0) throw new Error("Oracle watcher cleanup failed.");
  } finally {
    for (const stream of logFiles) stream.end();
    try { unlinkSync(launcherLock); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
};
process.on("SIGINT", () => { stop().catch((error) => { console.error(error.message); process.exitCode = 1; }); });
process.on("SIGTERM", () => { stop().catch((error) => { console.error(error.message); process.exitCode = 1; }); });

function start(name, script, extra, onLine = () => {}) {
  const path = resolve("logs", `${name}-${Date.now()}.log`);
  const output = createWriteStream(path, { flags: "a", mode: 0o600 });
  logFiles.push(output);
  console.log(`${name} raw log: ${path}`);
  const child = spawn(process.execPath, ["--env-file=.env", script, ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = redact(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        output.write(`${line}\n`);
        if (/HTTP 429.*(retry|trying)/i.test(line)) summaries += 1;
        else console.log(`[${name}] ${line}`);
        onLine(line);
      }
    });
    stream.on("end", () => { if (buffer) output.write(redact(buffer)); });
  }
  child.on("exit", (code, signal) => {
    if (!shuttingDown && (child !== keeper || !oneRound || code !== 0)) {
      console.error(`${name} exited unexpectedly (${signal ?? code}).`);
      process.exitCode = 1;
      stop().catch((error) => console.error(error.message));
    }
  });
  return child;
}

try {
  const preflight = spawn(process.execPath, ["--env-file=.env", "contracts/script/demo-preflight.mjs", "--allow-open-round"], { stdio: "inherit" });
  const [preflightCode] = await once(preflight, "exit");
  if (shuttingDown) throw new Error("Launch cancelled.");
  if (preflightCode !== 0) throw new Error("Preflight failed; fix the reported issues before starting.");
  const baseline = await publicClient.readContract({ address: deployment.contracts.quantumRound, abi: roundAbi, functionName: "roundCount" });
  const target = baseline + 1n;
  if (preset === "full") console.log("Full preset does not automatically open rounds; its existing timing is unchanged.");
  let started = false;
  let waiting = false;
  let resolveReady;
  const ready = new Promise((resolveReady_) => { resolveReady = resolveReady_; });
  agents = start("agents", "agents/run.mjs", ["--execute", "--preset", preset, "--wait-next-round"], (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === "runtime_started") started = true;
      if (event.type === "waiting_for_next_round") waiting = true;
      if (started && waiting) resolveReady();
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  });
  let timer;
  await Promise.race([
    ready,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Agent startup timed out after 60 seconds.")), 60_000); }),
    once(agents, "exit").then(() => { throw new Error("Agent runtime exited before readiness."); }),
  ]).finally(() => clearTimeout(timer));
  if (shuttingDown) throw new Error("Launch cancelled.");
  keeper = start("keeper", "contracts/script/keeper-run.mjs", ["--preset", preset, ...(oneRound ? ["--stop-after-round", String(target)] : [])]);
  const depositAbi = parseAbi(["function deposits(uint256,address) view returns (uint256)"]);
  const forecasters = readAgents().filter((agent) => agent.type === "forecaster");
  let checking = false;
  statusTimer = setInterval(async () => {
    if (checking || shuttingDown) return;
    checking = true;
    try {
      const id = await publicClient.readContract({ address: deployment.contracts.quantumRound, abi: roundAbi, functionName: "roundCount" });
      const [block, oracle] = await Promise.all([publicClient.getBlock(), publicClient.readContract({ address: deployment.contracts.priceOracle, abi: oracleAbi, functionName: "latestPrice" })]);
      if (id === 0n) console.log(`[status] no round; oracle age ${Number(block.timestamp - oracle[2])}s`);
      else {
        const r = await publicClient.readContract({ address: deployment.contracts.quantumRound, abi: roundAbi, functionName: "rounds", args: [id] });
        const phase = r[13] ? "cancelled" : r[10] ? "settled" : r[9] ? "evaluation" : block.timestamp >= r[1] ? "awaiting collapse" : "trading";
        const end = r[9] ? r[2] : r[1];
        console.log(`[status] round ${id}: ${phase}, ${Math.max(0, Number(end - block.timestamp))}s left, ${r[7]} proposals, oracle age ${Number(block.timestamp - oracle[2])}s`);
        if (oneRound && id >= target && (r[10] || r[13])) {
          const deposits = await Promise.all(forecasters.map((agent) => publicClient.readContract({ address: deployment.contracts.quantumRound, abi: depositAbi, functionName: "deposits", args: [target, agent.address] })));
          if (deposits.every((amount) => amount === 0n)) await stop();
        }
      }
    } catch (error) { console.error(`[status] read failed: ${error.shortMessage ?? error.message}`); }
    finally { checking = false; }
  }, 15_000);
  const summaryTimer = setInterval(() => { if (summaries) console.log(`[rpc] ${summaries} rate-limit retries in the last 30s`); summaries = 0; if (shuttingDown) clearInterval(summaryTimer); }, 30_000);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  await stop();
}
