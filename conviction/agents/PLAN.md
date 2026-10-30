# Wavefund agent plan

**Status:** Steps 2 and 3 are implemented. The deployed Phase B v2 contracts remain unchanged. Agent wallets are funded under explicit approval; no agent proposal has been submitted.

## 1. Wallets and custody

Use one Circle developer-controlled EOA on Arc Testnet per agent: Momentum, Mean-reversion, News, Quant, and Guardian. Circle's [supported-blockchain matrix](https://developers.circle.com/wallets/supported-blockchains.md) lists Arc (`ARC` / `ARC-TESTNET`) as supported for developer-controlled EOA and SCA wallets. EOA wallets are the simplest fit for independently registered proposer addresses and ordinary contract calls. Circle's Wallets API submits the transactions; the runtime must not treat a Circle wallet as a local viem private-key account.

Use `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET`; keep both and any entity-secret recovery material out of source control. The `agents:setup` command is user-run and provisions one Circle developer-controlled EOA per agent on `ARC-TESTNET`; it writes only public addresses to `agents/agents.json` and Circle wallet IDs to `.env`. Never print or log credentials. Circle is the default signer. The local signer backend is disabled unless the user separately approves it with `AGENT_LOCAL_SIGNER_APPROVED=true`; it must use distinct agent keys and can never use deployer or keeper keys.

## 2. Proposer registration and contract calls

`ProposerRegistry.registerAgent(string)` is permissionless and registers `msg.sender` as active; an admin cannot register another wallet for it. Each of the three proposer wallets therefore registers itself once, using its chosen display name. Registration needs no admin transaction or role grant.

For each proposer wallet:

1. After reviewing all addresses and exact amounts, the user may approve a plain USDC transfer from the deployer wallet to the agent wallets. No agent wallet funding is currently approved. Do not use Circle transfers or the keeper key for funding.
2. Call USDC `approve(ProposerRegistry, 1_000_000)` for the fixed 1 USDC bond.
3. During an open round, call `QuantumRound.propose(roundId, { tEthBps }, rationale)`. `QuantumRound` calls the registry to lock the 1 USDC bond from the proposer; the bond is refunded at collapse. Proposers do not call `lockBond` directly.

The two forecasters do not register in `ProposerRegistry`. Each approves QuantumRound for its 1 USDC deposit, calls `deposit` once per round, claims credits independently in every proposal, and trades through `buyLong`, `buyShort`, `sellLong`, and `sellShort`. The runtime gets each minimum output from the adapter's corresponding `quote*` view and applies the project's 0.5% slippage tolerance. After settlement, each forecaster calls `redeem`.

No agent may open, collapse, cancel, trade the vault, update the oracle, settle, or release seed. Those remain keeper/protocol operations.

## 3. Agent strategies and data

All proposals target tETH allocation in basis points (`0..10_000`) and submit a concise rationale as the proposal's on-chain string. The agent directory maps each public wallet address to its name, type, and one-line description.

| Agent | Role | Inputs and decision |
|---|---|---|
| Momentum | Proposer | Coinbase ETH/USD candles at fixed recent intervals; calculate short-horizon trend and map its bounded signal to a target tETH allocation. |
| Mean-reversion | Proposer | Coinbase ETH/USD history; compare price with a moving average and scale the deviation by realized volatility before selecting allocation. |
| News | Proposer | Recent crypto headlines from a public RSS feed plus Coinbase price/candle data; ask Claude for strict JSON matching a validated schema. If the API fails or output is invalid, use deterministic headline scoring and state that fallback in the rationale. |
| Quant | Forecaster | For each proposal, use current price, drift, volatility, the proposal allocation, and the round evaluation horizon to estimate vault simple return. Convert to fair probability with `pFair = clamp((1 + E[return] - rMin) / (rMax - rMin), 0, 1)`. Trade only when the market probability differs by more than the configured threshold. |
| Guardian | Forecaster | Compare each proposal's on-chain probability with Quant's fair value; trade toward fair value only when the deviation breaches the manipulation threshold, with stricter attention near the final TWAP window. Log the signal, threshold, and intervention. |

Forecasters evaluate every proposal, including status quo. Since proposal markets are thin, trade actions stay small; do not use a constant-product approximation. Proposer agents skip a proposal if an existing target in the same round is within 500 bps (5 percentage points).

## 4. Budget and funding

Initial per-agent caps for a separately approved first live run:

| Agent group | Count | Per-agent principal cap | Daily gas cap | Group total |
|---|---:|---:|---:|---:|
| Proposers | 3 | 1.00 USDC bond (refunded at collapse) | 0.25 USDC | 3.75 USDC |
| Forecasters | 2 | 1.00 USDC deposit | 0.25 USDC | 2.50 USDC |
| **Total** | **5** | **5.00 USDC principal** | **1.25 USDC** | **6.25 USDC maximum initial funding** |

The forecaster's 1 USDC deposit backs its credits. Cap each trade at 0.50 USDC and total claimed/tradable credits at 1.00 USDC per proposal; the same deposit may be claimed independently in every proposal, but only the winning proposal determines redemption and P&L. This is not a 1 USDC total limit across all markets. Do not top up a wallet or exceed these caps without the user's approval.

Arc's ERC-20 USDC (6 decimals) and native gas balance (18-decimal view) represent the same asset. Budget them once: never add the two balance views together. The 0.25 USDC per-agent daily gas cap is a maximum; stop rather than transact if the expected fee would exceed it. Bonds and forecaster deposits are principal, not expected losses, but forecaster P&L can reduce the deposit. This agent budget excludes any protocol-market seed top-up. Check the unallocated reserve before opening a round; at 5 USDC per proposal, status quo plus three proposals require 20 USDC. No seed top-up is authorized here.

No funding is approved yet. Any future funding must be a plain transfer from the deployer wallet, only after the user approves the exact total and per-agent amounts. Do not fund from the keeper wallet or use the agent signer to fund agents.

## 5. Round flow and keeper compatibility

Keep the existing keeper as the only actor that opens rounds and drives collapse, vault execution, oracle updates, and settlement. `keeper:run` opens status-quo-only rounds. New rounds use a 600-second evaluation horizon by default and recompute one-minute candle volatility at each opening. Use three standard deviations over the horizon, rounded to the nearest 0.5 percentage point and bounded to a symmetric 0.5%–2.0% band. If the candle feed is missing, invalid, or stale, fail closed rather than use fixed bounds.

The operator `demo:open-round` path opens status quo only; legacy deployer/keeper demo proposals require the explicit `--with-demo-proposals` flag. Proposers are scheduled early in the trading window and forecasters periodically, including once in its final minute. In Step 2 these are scheduling hooks only: the decision strategies and agent transactions are deliberately deferred to Steps 3 and 4. Agents must never call keeper actions. The keeper remains configured independently; use `--horizon` to override the 600-second default.

## 6. Identity, rationale, and frontend

`agents/agents.json` contains only `address`, `name`, `type`, and a one-line `description`; the checked-in template uses `null` addresses until the user runs `agents:setup`. Do not store wallet IDs, keys, entity secrets, API keys, or recovery material in this file. Proposal rationales are passed directly to `QuantumRound.propose` and stored on-chain. Runtime decision and transaction logs are timestamped, local, ignored by git, and exclude credentials.

## 7. Safety and validation gates

- Unit-test each proposer calculation, JSON validation/fallback, Quant fair-value math, trade sizing, and Guardian threshold behavior with fixed fixtures.
- `agents:run` defaults to dry-run. `--dry-run` reads and reports scheduled evaluations without signing or submitting. Live submission requires both `--execute` and explicit `AGENT_LIVE_TRANSACTIONS_APPROVED=true`. Add explicit maximum spend, proposal count, trade size, and per-round deduplication guards.
- Reuse `demo-round-common.mjs` for Arc chain checks, quote/price helpers, confirmation, gas policy, and safe transaction confirmation where applicable. Circle Wallets uses its own transaction submission/status lifecycle; do not copy private-key submission or retry a transaction after it may have been broadcast. Back off on RPC 429s and stop on unexpected chain state.
- Shrink the estimated ten-minute log drift by 50% toward zero. Cap its magnitude at 25% of the three-sigma volatility band before applying it to Quant's fair-value estimate. For the original candle sample and ±1.0% band, example fair probabilities are approximately 0.5018, 0.5044, and 0.5071 for 20%, 50%, and 80% tETH allocations. Recompute from recent candles before using in a live strategy.
- Before any live round, report wallet addresses, proposed budgets, fees, round state, available protocol seed, and exact USDC transfers; wait for approval. A live test only proceeds after separate approval of funding and actions.
- Step 5 must include a testnet manipulation scenario: a test wallet pushes one proposal's `pLong`, then Guardian trades it back toward fair value. Report the injected and restored prices, threshold decision, trade amounts, and fees; obtain approval before any live agent transaction.
- Do not alter deployed contracts, addresses, `current.json`, or an existing open/unsettled round. On a revert or any balance/reconciliation mismatch, stop and report. After a successful round, reconcile deposits, winner-only claims, redemptions, returned bonds, reserve, and ERC-20 USDC balances without summing the native balance view.

### Step 3 implementation

Momentum standardizes the ten-minute log return by recent one-minute realized volatility; mean-reversion standardizes the latest price's deviation from its 30-minute average. Both target a neutral 50% tETH allocation, move by 15 percentage points per signal z-score, clamp to 20–80%, and round to whole percentage points. News uses up to ten recent CoinDesk RSS headlines and, when `ANTHROPIC_API_KEY` is configured, asks Claude for a strict `{ tEthBps, rationale }` JSON response. Any feed/model/schema failure is recorded and uses bounded deterministic headline scoring (neutral if no headlines are available). Dry-run evaluates these strategies only while a real round is in its trading window; live proposal submission remains disabled.
