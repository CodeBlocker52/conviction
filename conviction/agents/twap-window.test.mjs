import test from "node:test";
import assert from "node:assert/strict";
import { defaultTwapWindow, parseTwapWindowArg, resolveTwapWindow } from "../contracts/script/twap-window.mjs";

test("default TWAP window is 25% of trading, at least 120 s", () => {
  assert.equal(defaultTwapWindow(20 * 60), 300);
  assert.equal(defaultTwapWindow(10 * 60), 150);
  assert.equal(defaultTwapWindow(3 * 60), 120);
  assert.equal(defaultTwapWindow(24 * 3600), 21_600);
});

test("an explicit window is validated against the contract's constraints", () => {
  assert.equal(resolveTwapWindow(undefined, 1_200), 300);
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
