// Runs each agent group in its own loop so a slow transaction in one never delays another.
export async function runIndependentLoops({
  loops,
  pollSeconds,
  once = false,
  isStopping,
  requestStop,
  onError,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const waitFor = async (durationMs) => {
    for (let remaining = durationMs; remaining > 0 && !isStopping(); remaining -= 500) {
      await sleep(Math.min(remaining, 500));
    }
  };

  const runLoop = async ({ name, tick, pollSeconds: loopPoll = pollSeconds }) => {
    let failures = 0;
    do {
      try {
        await tick();
        failures = 0;
      } catch (error) {
        if (error.fatal) {
          requestStop();
          throw error;
        }
        failures += 1;
        const backoffSeconds = Math.min(loopPoll * 2 ** (failures - 1), 120);
        onError({ name, error, backoffSeconds });
        if (once) throw error;
        await waitFor(backoffSeconds * 1_000);
        continue;
      }
      if (once) break;
      if (!isStopping()) await waitFor(loopPoll * 1_000);
    } while (!isStopping());
  };

  const results = await Promise.allSettled(loops.map(runLoop));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
