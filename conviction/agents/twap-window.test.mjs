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
