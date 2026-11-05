# Demo-day runbook

Live site: https://conviction-brown.vercel.app (click **Use on-chain data**). Network: Arc Testnet. Explorer: https://explorer.testnet.arc.io

## Commands, in order

Run from the repo root, each in its own terminal. Never print or share `.env`.

1. **Preflight** (read-only). Must end with `READY`; it tells you what to fix.
   ```
   npm run demo:preflight
   ```
2. **Recenter the pool, only if preflight says it is more than 0.5% off the oracle.**
   ```
   npm run pool:recenter -- --max-new-usdc 1 --execute --yes
   ```
3. **Open the first judge round, then start the keeper** (it collapses, runs the vault trade, settles, and opens the next round about 1 minute after each settlement; it also runs the oracle watcher).
   ```
   npm run demo:open-round -- --preset judge --execute --yes
   npm run keeper:run -- --preset judge --open-every 1
   ```
4. **Start the agents** (three proposers, Quant, Guardian; real Circle-wallet transactions).
   ```
   npm run agents:run -- --execute --preset judge
   ```

Judge round timeline: 8-minute trading window, proposals in the first 4 minutes, 240 s TWAP window at the end, then a 120 s evaluation. A full cycle is about 11 minutes including the pause. Use `--preset full` (20 min / 600 s TWAP / 600 s evaluation) only for validation.

## Four-minute slot

1. **Live round on the site** (30 s). Markets page: the status quo plus the proposal cards the agents just created. Each card shows the agent's name, type and its on-chain rationale.
2. **An agent rationale** (30 s). Open a card: e.g. Momentum's trend signal, or a rationale that says "shifted … to stay distinct". If News shows "fallback used", say so: the Claude call is optional and the fallback is deterministic.
3. **One deposit, many markets** (60 s). On the Agents page or the explorer, show the Quant's single 2 USDC deposit and its claims in every proposal. This is the quantum-markets feature: one deposit counts in every proposal at once.
4. **Collapse and vault trade on the explorer** (60 s). After the trading window: the `collapse` transaction picks the winner, then `executeTrade` moves the vault. Open the links for a finished round (below).
5. **The Guardian story** (60 s). Round 7: a deployer strike pushed proposal 1 from 0.4996 to 0.5689 with 44 s left; the Quant sold it back (0.5454) and the Guardian bought SHORT (0.5025). Honest ending: the defence worked but came late against a 60 s TWAP, so the TWAP window is now 50% of the trading window. A well-timed late strike on thin liquidity can still sway a round, at a cost to the manipulator (see README, Known limitations).

## Explorer links for the best completed rounds

- Round 7 (Guardian and Quant correct a live strike): open [86d70a…](https://explorer.testnet.arc.io/tx/0x86d70aee1825c2ffa9e9ed9d0cdf0bf7d9a2edc6cea97e18f56c772acf375b8c), Quant SELL [7fcdf5…](https://explorer.testnet.arc.io/tx/0x7fcdf5db23070a4a34d9fbf2063f77c54fd36704fcbf3e4f8a73520417706c13), Guardian BUY SHORT [e00e33…](https://explorer.testnet.arc.io/tx/0xe00e33c49e217db708149e6f41e8a32da6e1d3eb936cce894baf81a12b0d7ff3), collapse [af8df9…](https://explorer.testnet.arc.io/tx/0xaf8df987c405f5a32c553135fa01ef29e1b2ddbbf914a122e804b1d5d4dca684), vault trade [06bd46…](https://explorer.testnet.arc.io/tx/0x06bd4652f3118527f2c85b5028083ef34da21b875b83a66e79e821686a487101), settle [2595ad…](https://explorer.testnet.arc.io/tx/0x2595ad6927102dc61359f4fe5f2fef4ac289eaeca119feccb2b7a6a4b010e7a2).
- Round 6 (first live agent round): open [3ea9…](https://explorer.testnet.arc.io/tx/0x3ea9d4c58a34e740177e3bc2fdfd1a3e3ce2cc8b9ed63b74492493a285db855a), collapse [61cf26…](https://explorer.testnet.arc.io/tx/0x61cf260fe23914006db50a944349ff1bf8c9217643a7f2045d545931ccb870df), vault trade [c2f836…](https://explorer.testnet.arc.io/tx/0xc2f836905afbe1ec9568a1d0343e5971979669b85e853c2de2366ae724e5e78a), reportReturn [22af29…](https://explorer.testnet.arc.io/tx/0x22af2982f63111f0f25199ddde209bd2f46ebc9575dfaa5419e58db55d760be4).
- Best completed rehearsal rounds (judge preset, full cycle with three proposals and two forecaster deposits): [round 15](https://explorer.testnet.arc.io/tx/0x30dc11a48182f95a49a4d6eb6adc84cb1802d2b71791f83f363d588f92c4646b) (open; collapse [tx](https://explorer.testnet.arc.io/tx/0x80c4d3cdc05251abd2dd3c84097e32a7321dc9a41b56da8689a1ca425dbf3879), vault [tx](https://explorer.testnet.arc.io/tx/0x9e6b87d25ff07b9d54812056f7f341c92dac8bb8b18cc20e493ee53dd6563501)) and [round 16](https://explorer.testnet.arc.io/tx/0x0a1a339fd072f2f44bef6c0e04bda0630b7527a8df5e1352614d185fed90f739) (collapse [tx](https://explorer.testnet.arc.io/tx/0xac0b86ac287d64617b48183151c7fab69ae7b14a0251f9b8775bd034743c8e5c), vault [tx](https://explorer.testnet.arc.io/tx/0x4c1f5003b9816bb12e34c534a40493febb9c332a1bfcd3616f643dc2a37d578c)). Both settled with the status quo winning. For the Guardian story, use rounds 6 and 7.
- Latest full-preset round with the Quant trading all four markets from one deposit and the Guardian reacting to a live-site trade: [round 17](https://explorer.testnet.arc.io/tx/0x4235d62da71b0ec8c7430c094dade36d1de6bc85bb277b6c13c9c24d0135cc0f) (collapse [tx](https://explorer.testnet.arc.io/tx/0x1c2341982d634320898babaa5bce3dd979cc7fcddd33b0a543c0320969bedaa0), vault [tx](https://explorer.testnet.arc.io/tx/0x53bc15e95873149df8a67394f7102942c561d40c30b6992360b3fee4de2d9aa5), settle [tx](https://explorer.testnet.arc.io/tx/0xb5e8862e671ea073f737dc4691418909adc90499b569a2f5045de4da68c51817)).
- Pool note: if `pool:recenter` asks for about 10 USDC of new money, check that `contracts/deployments/pool-position.json` matches the live ticks (197100..200040 as of round 17); never revert it with `git checkout` after a recenter.
- Rehearsal rounds: see the end of [contracts/deployments/demo-round.md](contracts/deployments/demo-round.md) for the latest, with every transaction link.

## If something fails

1. **Stop the agents first** (Ctrl-C in the agents terminal). They release their lock on exit; if a crash left `agents/.runtime.lock`, delete that file before restarting.
2. Do not retry in a loop. Run `npm run demo:preflight` to see which wallet, the reserve, the pool or the oracle is the problem.
   - Stale oracle: `npm run oracle:update`. Pool off: step 2 above. Low agent balance: top it up from the deployer.
3. If a round is stuck open, the keeper still collapses and settles it at the right time; leave `keeper:run` running.
4. If it cannot be recovered in time, **show a recorded round**: use the links above and [demo-round.md](contracts/deployments/demo-round.md), which has every transaction, price and reconciliation.

## Stopping everything cleanly

1. Ctrl-C the agents terminal, then wait for it to print that it stopped.
2. Wait for any open round to settle (the keeper does this), then Ctrl-C the keeper terminal. Do not stop the keeper mid-round, or collapse and settlement have to be done by hand (`npm run demo:close-round -- --execute`).
3. Stop the oracle watcher if it is still running: `npm run oracle:stop`.
4. Confirm: `npm run demo:preflight` shows no open round, and `agents/.runtime.lock` does not exist.
