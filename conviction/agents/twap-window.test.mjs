import test from "node:test";
import assert from "node:assert/strict";
import { defaultTwapWindow, parseTwapWindowArg, resolveTwapWindow } from "../contracts/script/twap-window.mjs";

test("default TWAP window is 50% of trading, at least 300 s, never above the trading window", () => {
  assert.equal(defaultTwapWindow(20 * 60), 600);
  assert.equal(defaultTwapWindow(10 * 60), 300);
  assert.equal(defaultTwapWindow(8 * 60), 300);
  assert.equal(defaultTwapWindow(4 * 60), 240);
  assert.equal(defaultTwapWindow(24 * 3600), 43_200);
});

test("an explicit window is validated against the contract's constraints", () => {
  assert.equal(resolveTwapWindow(undefined, 1_200), 600);
  assert.equal(resolveTwapWindow("90", 1_200), 90);
  assert.equal(resolveTwapWindow(1_200, 1_200), 1_200);
  assert.throws(() => resolveTwapWindow(1_201, 1_200), /cannot exceed/);
  assert.throws(() => resolveTwapWindow(0, 1_200), /positive/);
  assert.throws(() => resolveTwapWindow("abc", 1_200), /positive/);
  assert.throws(() => resolveTwapWindow(1.5, 1_200), /positive/);
});

test("--twap-window is parsed from the CLI arguments", () => {
  assert.equal(parseTwapWindowArg(["--minutes", "20", "--twap-window", "240"]), "240");
  assert.equal(parseTwapWindowArg(["--minutes", "20"]), undefined);
});

test("presets: judge is 8 min / 240 s TWAP / 120 s evaluation with a 3 USDC daily gas cap; full keeps the validated defaults", async () => {
  const { PRESETS, parsePresetArg } = await import("../contracts/script/presets.mjs");
  assert.deepEqual(parsePresetArg(["--preset", "judge"]), { name: "judge", ...PRESETS.judge });
  assert.equal(PRESETS.judge.tradingMinutes, 8);
  assert.equal(PRESETS.judge.twapWindow, 240);
  assert.equal(PRESETS.judge.horizonSeconds, 120);
  assert.equal(PRESETS.judge.dailyGasCapUsdc, "3");
  assert.equal(PRESETS.full.tradingMinutes * 60, 1_200);
  assert.equal(PRESETS.full.twapWindow, defaultTwapWindow(PRESETS.full.tradingMinutes * 60));
  // Both presets satisfy the contract's twapWindow constraints.
  for (const preset of Object.values(PRESETS)) assert.equal(resolveTwapWindow(preset.twapWindow, preset.tradingMinutes * 60), preset.twapWindow);
  assert.equal(parsePresetArg([]), undefined);
  assert.throws(() => parsePresetArg(["--preset", "nope"]), /must be one of/);
});
