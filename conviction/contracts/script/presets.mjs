// Round presets shared by keeper-run.mjs, demo-open-round.mjs and agents:run.
// "full": the validation round (20 min trading, 600 s TWAP, 600 s evaluation).
// "judge": short back-to-back rounds for a live demo (8 min trading, 240 s TWAP, 120 s evaluation, next round ~1 min after settlement).
export const PRESETS = {
  full: { tradingMinutes: 20, twapWindow: 600, horizonSeconds: 600, openEveryMinutes: 0, dailyGasCapUsdc: "1" },
  judge: { tradingMinutes: 8, twapWindow: 240, horizonSeconds: 120, openEveryMinutes: 1, dailyGasCapUsdc: "3" },
};

export function parsePresetArg(args) {
  const index = args.indexOf("--preset");
  if (index === -1) return undefined;
  const name = args[index + 1];
  if (!Object.hasOwn(PRESETS, name ?? "")) {
    throw new Error(`--preset must be one of: ${Object.keys(PRESETS).join(", ")}.`);
  }
  return { name, ...PRESETS[name] };
}
