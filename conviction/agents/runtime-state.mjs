import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const runtimeStatePath = fileURLToPath(new URL("./.runtime-state.json", import.meta.url));

export function loadRuntimeState(path = runtimeStatePath) {
  if (!existsSync(path)) return { version: 1, rounds: {} };
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (state.version !== 1 || !state.rounds || typeof state.rounds !== "object" || Array.isArray(state.rounds)) {
    throw new Error("Agent runtime state has an unsupported or invalid format.");
  }
  return state;
}

export function saveRuntimeState(state, path = runtimeStatePath) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}
