function parseInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
  return parsed;
}

export function resolveTradingSeconds({ args, preset, environmentMinutes, defaultMinutes, manualFlag }) {
  const index = args.indexOf(`--${manualFlag}`);
  if (index >= 0) {
    const minutes = parseInteger(args[index + 1], `--${manualFlag}`);
    if (minutes < 3 || minutes > 1_440) {
      throw new Error(`--${manualFlag} must be between 3 and 1440 whole minutes.`);
    }
    return minutes * 60;
  }
  if (preset?.tradingSeconds !== undefined) return preset.tradingSeconds;
  const minutes = Number(preset?.tradingMinutes ?? environmentMinutes ?? defaultMinutes);
  if (!Number.isInteger(minutes) || minutes < 3 || minutes > 1_440) {
    throw new Error(`Trading window must be between 3 and 1440 whole minutes.`);
  }
  return minutes * 60;
}

export function resolveHorizonSeconds({ args, preset, environmentSeconds, defaultSeconds = 600 }) {
  const index = args.indexOf("--horizon");
  if (index >= 0) {
    const horizon = parseInteger(args[index + 1], "--horizon");
    if (horizon < 60 || horizon > 86_400) {
      throw new Error("--horizon must be between 60 and 86400 whole seconds.");
    }
    return horizon;
  }
  const horizon = Number(preset?.horizonSeconds ?? environmentSeconds ?? defaultSeconds);
  const minimum = preset?.name === "demo3" ? 45 : 60;
  if (!Number.isInteger(horizon) || horizon < minimum || horizon > 86_400) {
    throw new Error(`Evaluation horizon must be between ${minimum} and 86400 whole seconds.`);
  }
  return horizon;
}

export function resolveKeeperOpenIntervalSeconds({ args, preset }) {
  const minutesIndex = args.indexOf("--open-every");
  const secondsIndex = args.indexOf("--open-every-seconds");
  if (minutesIndex >= 0 && secondsIndex >= 0) {
    throw new Error("Use either --open-every or --open-every-seconds, not both.");
  }
  if (secondsIndex >= 0) {
    if (preset?.name !== "demo3") throw new Error("--open-every-seconds is available only with --preset demo3.");
    const seconds = parseInteger(args[secondsIndex + 1], "--open-every-seconds");
    if (seconds < 1) throw new Error("--open-every-seconds must be a positive whole number.");
    return seconds;
  }
  if (minutesIndex >= 0) {
    const minutes = parseInteger(args[minutesIndex + 1], "--open-every");
    if (minutes < 0) throw new Error("--open-every must be a nonnegative whole number of minutes.");
    return minutes * 60;
  }
  if (preset?.openEverySeconds !== undefined) return preset.openEverySeconds;
  return Number(preset?.openEveryMinutes ?? 0) * 60;
}
