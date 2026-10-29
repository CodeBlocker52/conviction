# Wavefund agent plan

**Scope:** planning only. No agent wallets, transactions, protocol changes, or runtime code are created by this document. The deployed Phase B v2 contracts remain unchanged.

## 1. Wallets and custody

Use one Circle developer-controlled EOA on Arc Testnet per agent: Momentum, Mean-reversion, News, Quant, and Guardian. Circle's [supported-blockchain matrix](https://developers.circle.com/wallets/supported-blockchains.md) lists Arc (`ARC` / `ARC-TESTNET`) as supported for developer-controlled EOA and SCA wallets. EOA wallets are the simplest fit for independently registered proposer addresses and ordinary contract calls. Circle's Wallets API submits the transactions; the runtime must not treat a Circle wallet as a local viem private-key account.

The user will provision `CIRCLE_API_KEY` and `ENTITY_SECRET`. The user must generate/register the entity secret and keep its recovery material outside the repository. Store credentials only in the ignored `.env`; never commit, print, or log them. `agents/agents.json` contains public addresses and public metadata only. If Circle API access or Arc Testnet contract-execution support is unavailable at implementation time, stop and ask before switching to separate local agent keys; never reuse deployer or keeper keys.

## 2. Proposer registration and contract calls

`ProposerRegistry.registerAgent(string)` is permissionless and registers `msg.sender` as active; an admin cannot register another wallet for it. Each of the three proposer wallets therefore registers itself once, using its chosen display name. Registration needs no admin transaction or role grant.

For each proposer wallet:

1. Fund its Arc wallet under the approved budget.
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
| News | Proposer | Recent crypto headlines from a public RSS feed plus Coinbase price/candle data; ask Claude for strict JSON matching a validated schema. If the API fails or output is invalid, use a deterministic price-only fallback and state that in the rationale. |
| Quant | Forecaster | For each proposal, use current price, drift, volatility, the proposal allocation, and the round evaluation horizon to estimate vault return. Convert to fair probability with `pFair = clamp((E[R] - rMin) / (rMax - rMin), 0, 1)`. Trade only when the market probability differs by more than the configured threshold. |
| Guardian | Forecaster | Compare each proposal's on-chain probability with Quant's fair value; trade toward fair value only when the deviation breaches the manipulation threshold, with stricter attention near the final TWAP window. Log the signal, threshold, and intervention. |

Forecasters evaluate every proposal, including status quo. Since proposal markets are thin, trade actions stay small; do not use a constant-product approximation. Proposer agents skip a proposal if an existing target in the same round is within 500 bps (5 percentage points).

## 4. Budget and funding

Initial per-round caps for the first live run:

| Agent group | Count | Per-agent principal cap | Gas cap | Group total |
|---|---:|---:|---:|---:|
| Proposers | 3 | 1.00 USDC bond (refunded at collapse) | 0.25 USDC | 3.75 USDC |
| Forecasters | 2 | 1.00 USDC deposit | 0.25 USDC | 2.50 USDC |
| **Total** | **5** | **5.00 USDC principal** | **1.25 USDC** | **6.25 USDC maximum initial funding** |

The forecaster's 1 USDC deposit backs its credits. Cap each trade at 0.50 USDC and total claimed/tradable credits at 1.00 USDC per proposal; the same deposit may be claimed independently in every proposal, but only the winning proposal determines redemption and P&L. This is not a 1 USDC total limit across all markets. Do not top up a wallet or exceed these caps without the user's approval.

Arc's ERC-20 USDC (6 decimals) and native gas balance (18-decimal view) represent the same asset. Budget them once: never add the two balance views together. The 0.25 USDC per-wallet gas cap is a maximum; stop rather than transact if the expected fee would exceed it. Bonds and forecaster deposits are principal, not expected losses, but forecaster P&L can reduce the deposit. This agent budget excludes any protocol-market seed top-up. Check the unallocated reserve before opening a round; at 5 USDC per proposal, status quo plus three proposals require 20 USDC. No seed top-up is authorized here.

The user funds each new Circle wallet from a user-designated funding wallet, after reviewing the addresses and approving the total and per-wallet amounts. Do not fund from the deployer or keeper keys and do not send anything during planning.

## 5. Round flow and keeper compatibility

Keep the existing keeper as the only actor that opens rounds and drives collapse, vault execution, oracle updates, and settlement. `keeper:run` already opens a status-quo-only round when configured with `--open-every`; leave its keeper lifecycle intact.

Change the operator `demo:open-round` path to open the status-quo proposal only, then let `agents:run` observe the new round and submit the three proposals early in its trading window. Retain the current safety preflight and oracle watcher behavior, but remove assumptions that deployer and keeper wallets supply three proposals. Keep any legacy demo proposal behavior behind an explicit opt-in rather than making it the default. Agents must never call keeper actions.

## 6. Identity, rationale, and frontend

Commit `agents/agents.json` with entries containing only `address`, `name`, `type`, and a one-line `description`; do not store keys, entity secrets, API keys, or recovery material. Proposal rationales are passed directly in `QuantumRound.propose` and emitted/stored on-chain, with the proposer address linked to the public agent metadata. The frontend can resolve a proposal's proposer address to `agents.json` and show its name and rationale. Forecasting decisions and transactions are logged locally with timestamps and reasoning, excluding credentials.

## 7. Safety and validation gates

- Unit-test each proposer calculation, JSON validation/fallback, Quant fair-value math, trade sizing, and Guardian threshold behavior with fixed fixtures.
- `agents:run --dry-run` must read and report intended actions without signing or submitting. Add explicit maximum spend, proposal count, trade size, and per-round deduplication guards.
- Reuse `demo-round-common.mjs` for Arc chain checks, quote/price helpers, confirmation, gas policy, and safe transaction confirmation where applicable. Circle Wallets uses its own transaction submission/status lifecycle; do not copy private-key submission or retry a transaction after it may have been broadcast. Back off on RPC 429s and stop on unexpected chain state.
- Before any live round, report wallet addresses, proposed budgets, fees, round state, available protocol seed, and exact USDC transfers; wait for approval. A live test only proceeds after a separate approval of funding and actions.
- Do not alter deployed contracts, addresses, `current.json`, or an existing open/unsettled round. On a revert or any balance/reconciliation mismatch, stop and report. After a successful round, reconcile deposits, winner-only claims, redemptions, returned bonds, reserve, and ERC-20 USDC balances without summing the native balance view.
