import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLock } from "./demo-process.mjs";

test("absent and stale launcher locks are handled without signalling unrelated processes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wavefund-launcher-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "lock");
  assert.equal(inspectLock(path, "demo-live.mjs", { clearStale: true }), null);
  writeFileSync(path, "99999999");
  assert.equal(inspectLock(path, "demo-live.mjs", { clearStale: true }), null);
  assert.equal(existsSync(path), false);
  writeFileSync(path, String(process.pid));
  assert.throws(() => inspectLock(path, "demo-live.mjs"), /refusing to signal/);
});
