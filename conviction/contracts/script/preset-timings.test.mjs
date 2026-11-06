import test from "node:test";
import assert from "node:assert/strict";
import { parsePresetArg, PRESETS } from "./presets.mjs";
import {
  resolveHorizonSeconds,
  resolveKeeperOpenIntervalSeconds,
  resolveTradingSeconds,
} from "./preset-timings.mjs";
import { resolveTwapWindow } from "./twap-window.mjs";

const presetArgs = (name) => parsePresetArg(["--preset", name]);

test("demo3 uses a 120-second trading window and 45-second horizon", () => {
  const preset = presetArgs("demo3");
  assert.equal(resolveTradingSeconds({ args: [], preset, defaultMinutes: 30, manualFlag: "window" }), 120);
  assert.equal(resolveHorizonSeconds({ args: [], preset }), 45);
  assert.equal(preset.twapWindow, 60);
  assert.equal(resolveTwapWindow(preset.twapWindow, 120), 60);
  assert.equal(resolveKeeperOpenIntervalSeconds({ args: [], preset }), 20);
});

test("full and judge preset timings remain unchanged", () => {
  assert.deepEqual(PRESETS.full, {
    tradingMinutes: 20,
    twapWindow: 600,
    horizonSeconds: 600,
    openEveryMinutes: 0,
    dailyGasCapUsdc: "1",
  });
  assert.deepEqual(PRESETS.judge, {
    tradingMinutes: 8,
    twapWindow: 240,
    horizonSeconds: 120,
    openEveryMinutes: 1,
    dailyGasCapUsdc: "3",
  });
  assert.equal(resolveTradingSeconds({ args: [], preset: presetArgs("full"), defaultMinutes: 30, manualFlag: "window" }), 1_200);
  assert.equal(resolveTradingSeconds({ args: [], preset: presetArgs("judge"), defaultMinutes: 30, manualFlag: "window" }), 480);
  assert.equal(resolveKeeperOpenIntervalSeconds({ args: [], preset: presetArgs("judge") }), 60);
});

test("manual short timings remain rejected, including when a preset is selected", () => {
  const demo3 = presetArgs("demo3");
  assert.throws(
    () => resolveTradingSeconds({ args: ["--window", "2"], preset: demo3, defaultMinutes: 30, manualFlag: "window" }),
    /between 3 and 1440/,
  );
  assert.throws(() => resolveHorizonSeconds({ args: ["--horizon", "45"], preset: demo3 }), /between 60 and 86400/);
  assert.throws(
    () => resolveTradingSeconds({ args: ["--window", "2"], defaultMinutes: 30, manualFlag: "window" }),
    /between 3 and 1440/,
  );
  assert.throws(() => resolveHorizonSeconds({ args: ["--horizon", "45"] }), /between 60 and 86400/);
  assert.equal(resolveHorizonSeconds({ args: [], preset: presetArgs("judge") }), 120);
});

test("seconds-based reopen cadence is demo3-only and mutually exclusive with minute cadence", () => {
  assert.equal(resolveKeeperOpenIntervalSeconds({
    args: ["--open-every-seconds", "20"],
    preset: presetArgs("demo3"),
  }), 20);
  assert.throws(() => resolveKeeperOpenIntervalSeconds({
    args: ["--open-every-seconds", "20"],
    preset: presetArgs("judge"),
  }), /only with --preset demo3/);
  assert.throws(() => resolveKeeperOpenIntervalSeconds({
    args: ["--open-every", "1", "--open-every-seconds", "20"],
    preset: presetArgs("demo3"),
  }), /either --open-every or --open-every-seconds/);
});
