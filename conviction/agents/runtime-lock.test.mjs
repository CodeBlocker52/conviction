import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRuntimeIsRunning } from "./runtime-lock.mjs";

test("agent runtime check handles absent, stale and live locks", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wavefund-agent-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "lock");
  assert.equal(agentRuntimeIsRunning(path), false);
  writeFileSync(path, "invalid");
  assert.equal(agentRuntimeIsRunning(path), false);
  writeFileSync(path, "1234");
  assert.equal(agentRuntimeIsRunning(path, () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }), false);
  assert.equal(agentRuntimeIsRunning(path, (pid, signal) => { assert.equal(pid, 1234); assert.equal(signal, 0); }), true);
});
