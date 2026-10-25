# Wavefund Phase A — Contract Design

## Overview
Wavefund is a quantum-market prediction protocol where AI agents ("proposers") compete to forecast the optimal allocation for a USDC vault. Each round is a sealed-bid competition:
1. Proposers post an allocation (tETH/USDC ratio) with a bond
2. Forecasters deposit USDC and trade LONG/SHORT positions on proposals via on-chain constant-product markets
3. The proposal with the highest TWAP wins; the vault executes the winner's allocation on Uniswap v4
4. Realised returns are distributed to forecasters proportionally to their LONG/SHORT positions

## Actors
| Actor | Role | Contract |
|---|---|---|
| Proposer (AI agent) | Submits allocation proposals with a bond | ProposerRegistry, QuantumRound |
| Forecaster (user) | Deposits USDC, claims credits, trades LONG/SHORT | QuantumRound |
| Keeper | Opens rounds, collapses, updates ETH/USD price, executes and reports rounds | QuantumRound, WavefundVault, MockPriceOracle |
| Resolver | Accepts vault-authorized realised returns and settles rounds | Resolver |
| Protocol reserve | Supplies seed for every proposal; bears seeded-position gains and losses | QuantumRound |

## Round Lifecycle

```
openRound()
    → proposal 0 (status quo) auto-created
    → Phase A market seeded; Phase B adapter receives a protocol-owned complete-set seed

propose()               [any registered proposer, during trading window]
    → bond locked
    → credit/LONG/SHORT tokens deployed for proposal
    → market seeded from the same protocol reserve

deposit(amount)         [any forecaster, during trading window]
    → USDC held by QuantumRound

claimCredits(proposalId, amount)  [forecaster, during trading window]
    → credits minted 1:1 from deposit
    → aggregate cap: sum(claimed) ≤ deposit

buyLong / sellLong / buyShort / sellShort   [during trading window]
    → route through the configured IProposalMarket implementation
    → TWAP updated on each trade

collapse()              [anyone, after tradingEnd]
    → closeTwapWindow for all proposals
    → winner = proposal with highest TWAP > statusQuo + epsilon
    → bonds refunded (non-spam) or slashed (spam = TWAP < 20% of initial)

settle(roundId, return) [Keeper/Resolver, after evaluationEnd; or anyone after +2d]
    → realisedReturn recorded
    → proposer win counted if positive return

redeem()                [forecaster, after settled]
    → pi = clamp(realisedReturn, rMin, rMax) linearised to [0,1]
    → longPayout = longBal * pi
    → shortPayout = shortBal * (1 - pi)
    → unclaimed deposit returned 1:1
```

If vault execution breaches its 500 bps oracle-relative slippage cap, the nested swap is reverted atomically and the vault cancels the round. Forecasters can then redeem their full deposits at par; any proposal bonds are returned. Canceled rounds cannot be settled or traded afterward.

Admin may rescue only unallocated `protocolLiquiditySeed`, which is reduced when a proposal market is allocated. User deposits remain accounted for per round, and seed allocated to an existing round is not rescuable. QuantumLP is a Phase A custody stub and is not connected to proposal markets. Phase B v1 uses protocol-owned liquidity only; external LP shares, deposits, and claims are roadmap work. The live frontend does not render QuantumLP controls.

## Price Discovery (Phase A)
Each proposal uses a constant-product market (x*y=k) where:
- x = credit reserve (USDC units)
- y = LONG reserve (token units)
- The deployed contract's raw `spotPrice` is `creditReserve / longReserve`, scaled by `1e18`; it is credits per LONG token, starts at `1.0` with equal reserves, and is unbounded.
- The UI maps that reserve ratio to a bounded LONG probability: `creditReserve / (creditReserve + longReserve)`. This is `q / (1 + q)` for raw spot ratio `q`; it starts at `0.5` and rises when LONG is bought. The scalar implied return is `rMin + p * (rMax - rMin)`, displayed as a percentage change from 1.0.
- SHORT trades are fixed 1:1 in this Phase A contract, constrained by the market's credit reserve on buys and `shortIssued` on sells; they are not reserve-priced CPMM swaps.
- Fee = 0.3% (30 bps)
- TWAP accumulates: price * elapsed_seconds, updated on each trade

For example, the recorded raw spot `1.673306965668276829` is `1.6733` credits per LONG token (not LONG per credit). The bounded UI probability is `1.6733 / (1 + 1.6733) = 0.6259`. With `rMin = 0.95` and `rMax = 1.05`, the scalar implied return is `0.95 + 0.6259 * (1.05 - 0.95) = 1.01259`, or `+1.26%`. At `p = 0.5`, it is exactly `0.00%`.

This UI conversion does not cap the actual CPMM execution cost: a LONG share can cost more than its maximum one-credit settlement payout. The deployed market is immutable through the current QuantumRound, so correcting execution pricing requires a new bounded binary-market implementation and a coordinated deployment/migration; clamping `spotPrice` alone would only conceal the issue. A replacement market should use complementary LONG/SHORT collateral and a bounded pricing curve (for example LMSR).

The replacement market's regression suite should include `test_LongProbabilityIsBoundedAndComplementary`: seed a market, record LONG and SHORT probabilities, buy LONG, then assert the LONG probability increased, both prices remain in `[0, 1e18]`, and their sum remains `1e18`. Also cover large trades near both boundaries and verify they cannot produce a price above the maximum one-credit payout.

Phase B is intended to replace this with bounded Uniswap v4 LONG/SHORT hook pools (WaveHook.sol). Phase A remains the current deployed path.

## Payout Formula
Given:
- pi = (clamp(realisedReturn, rMin, rMax) - rMin) / (rMax - rMin)  [0,1]
- longBal = user's LONG token balance in the winning proposal
- shortBal = user's SHORT token balance in the winning proposal
- creditsClaimed = total credits allocated to winner by this user
- unclaimed = deposit - creditsClaimed

Payout (in USDC) = unclaimed + longBal * pi + shortBal * (1 - pi)

Note: longBal + shortBal ≤ creditsClaimed (credits not converted to either = lost).

## Vault (Phase A)
WavefundVault:
- Holds USDC and tETH
- Issues transferable 18-decimal WAVE shares; admin bootstrap funding also receives shares at the current oracle-marked NAV (initially 1 USDC per share)
- Users queue USDC deposits or escrow WAVE shares for withdrawal; both are processed at the next `executeTrade` decision boundary against the same pre-flow oracle NAV and share supply
- Withdrawal proceeds are paid in USDC, liquidating tETH through the configured v4 pool when needed and applying the vault slippage cap; users may cancel an unprocessed request
- Admin rescue is limited to token balances above pending deposits and shareholder-backed assets. QuantumRound capital deposits do not issue user shares; they accrue to existing holders, or remain admin-rescuable when the vault has no shares
- `migrateAdminFundedBalance` imports admin-held USDC into a replacement vault and issues shares; it cannot pull tokens from a legacy vault that has no withdrawal/approval path
- Keeper marks pre-trade NAV from a fresh ETH/USD oracle update, then calls executeTrade(roundId, winnerTEthBps)
- Vault swaps on Uniswap v4 USDC/tETH pool (no hook, fee=3000, tickSpacing=60) toward the target allocation
- Swap output must be within 500 bps of the oracle-implied expected output; otherwise the swap rolls back and the round is canceled
- After the evaluation period, reportReturn requires a fresh update published on or after evaluationEnd and submits the oracle-marked return
- Arc Testnet currently has no confirmed supported ETH/USD feed in this deployment; MockPriceOracle uses 8-decimal prices uploaded by the keeper from the public Coinbase ETH/USD spot endpoint
- The oracle timestamps updates on-chain, so the keeper must update immediately after reading the external API; this is a trusted testnet fallback, not a decentralized oracle
- The keeper updater supports a 60-second watch interval; update it again immediately before executing a NAV mark or reporting a resolution

## Contract Dependencies
```
QuantumRound
  ├── ProposalTokens (clone factory for CREDIT/LONG/SHORT tokens)
  ├── ConstantProductMarket (IProposalMarket — Phase A AMM)
  └── ProposerRegistry (bond custody)

Resolver → QuantumRound.settle()
  └── only WavefundVault is granted RESOLVER_ROLE in the deployment

WavefundVault
  ├── IPoolManager (Uniswap v4, 0x2756...)
  └── Resolver.submitReturn()
  ├── MockPriceOracle.latestPrice()
  └── QuantumRound.cancelRound() on slippage breach
```

## Key Constants
| Name | Value | Notes |
|---|---|---|
| DEFAULT_BOND | 1 USDC | Proposer bond |
| initialLiquidityPerProposal | 5 USDC (testnet) / 500 USDC (prod) | Per-proposal market seed |
| SPAM_THRESHOLD_PROBABILITY | 0.1e18 | LONG probability TWAP below this = bond slashed |
| EPSILON | 0.005e18 | Winner margin above status quo, in LONG probability (0.5 percentage points) |
| MAX_PROPOSALS_PER_ROUND | 10 | Includes status quo proposal 0 |
| EMERGENCY_SETTLE_DELAY | 2 days | Permissionless settle fallback |
| MAX_ORACLE_AGE | 5 minutes | Maximum age accepted at trade execution/reporting |
| maxSlippageBps | 500 | Maximum adverse swap slippage relative to oracle output |

## Phase B Protocol-Owned Liquidity Design

Phase B v1 has one protocol-owned USDC reserve. `initialLiquidityPerProposal` is reserved once per proposal when the round opens or a proposal is added. It is not a depositor share pool and no external account receives an LP claim. Losing markets must be unwound at collapse; their residual LONG/SHORT inventory is burned or returned to the reserve, and their seed allocation is released back into `protocolLiquiditySeed`. The winning market's seed remains reserved for settlement. User credit and outcome-token liabilities are paid first; any remaining winning seed returns to the protocol reserve after all user liabilities have been redeemed. Seeded-market gains or losses belong to the protocol reserve.

Credits are six-decimal USDC-denominated units. LONG and SHORT are eighteen-decimal outcome tokens, so one credit maps to `1e12` raw units of each outcome token. A complete set is one LONG plus one SHORT. Phase B must preserve this conversion through every buy/sell, adapter unwind, and redemption. Proposal-token clones remain 18-decimal by default for Phase A compatibility; the Phase B factory must be configured to create six-decimal CREDIT tokens before its first clone.

The market adapter preserves the `IProposalMarket` boundary. QuantumRound remains responsible for complete-set mint/burn, user collateral, scalar settlement, and protocol reserve accounting. The adapter owns only its v4 pools and positions: it may route bounded swaps and add/remove liquidity in `[-45900, 45900]` ticks at spacing 60. Liquidity removal is allowed for adapter-controlled finalization after trading closes. The adapter must return residual outcome inventory to QuantumRound for burning and settlement; it cannot assign claims to outside LPs.

The complete-set solvency invariant is:

```text
unclaimed deposits
+ outstanding credits across all proposals
+ winning LONG/SHORT scalar payout liabilities
<= remaining round deposits + winning protocol seed
```

Every redemption reduces both outstanding user liability and reserved collateral. Only after the final user liability reaches zero may the unused reserve be returned to `protocolLiquiditySeed`. Losing proposal LONG/SHORT tokens have no settlement value and must be burned on redemption. Credit tokens remain redeemable at par.

External LP shares/claims, cross-proposal LP accounting, fee distribution, migration of LP positions, and user-selectable liquidity ranges are explicitly out of scope for v1 and remain roadmap work. The deployed Phase A `QuantumLP` stub is not wired into this design.

### Phase B implementation and deployment gates

1. Implement and test the v4 adapter, complete-set flows, adapter-only bounded liquidity, collapse unwind, and seed accounting without changing deployment files.
2. Fuzz solvency across deposits, claims, buys/sells, settlement extremes, and partial redemption; include the bounded/complementary probability regression.
3. Keep Phase A deployment addresses, frontend addresses, and open rounds unchanged while the Phase B implementation is local-only.
4. Present a coordinated Phase B deployment/migration plan. Do not deploy or replace the current market until separately approved.
5. Update the keeper for the new market lifecycle only after the adapter and tests pass.

### Phase B compatibility spike

Phase B deploys one shared `WaveHook` for the adapter. `DeployWaveHook.s.sol` mines its CREATE2 salt off-chain with v4 `HookMiner`; neither QuantumRound nor the adapter searches for salts. The adapter registers every pool by `PoolId`, including its round, proposal, LONG token, trading window, and final TWAP window. Swaps and liquidity changes require a registered pool and are adapter-only during that pool's trading window; adapter-only liquidity removal is permitted after that pool closes. Positions stay within ticks `[-45900, 45900]`, corresponding to the intended probability range near 0.01–0.99 at tick spacing 60. `afterSwap` records separate price and probability time integrals for each pool.

The standalone Arc compatibility deployment is a throwaway single-pool test and is not the shared Phase B hook configuration. The current `current.json` remains the Phase A deployment config. Record the shared hook address there only as part of an explicitly approved Phase B deployment/cutover.

For a LONG/SHORT pool, let `q` be the pool's marginal quote of SHORT tokens per LONG token. If LONG is currency0, `q = sqrtPriceX96² / 2¹⁹²`; if LONG is currency1, invert that ratio. The displayed probability is `pLong = q / (1 + q)`, and `pShort = 1 - pLong`. Therefore the probability boundaries 0.01 and 0.99 correspond to `q = 1/99` and `q = 99`, respectively. The UI's scalar implied return is `rMin + pLong × (rMax − rMin)`; it must show this bounded value separately from the execution quote for the requested trade.

Phase B buy/sell accounting uses explicit units: one credit is 1 USDC-denominated credit (`1e6` raw units), while one LONG or SHORT is `1e18` raw token units. `ProposalTokens` now supports six-decimal CREDIT clones while LONG/SHORT remain eighteen-decimal. Buying LONG or SHORT must mint the matching complete-set inventory before the adapter swap; selling must burn the sold outcome, route it through the pool, redeem only matched complete sets for credits, and return unmatched outcome-token remainders to the seller. SHORT trades use the symmetric path. Any implementation must preserve minimum-output/slippage guarantees and must never create more collateral claims than deposits plus the reserved winning seed.

The Phase B market adapter must preserve the current `IProposalMarket` entry points for QuantumRound and expose the same UI-facing price, quote, and TWAP reads through one market address/ABI. The frontend must not read PoolManager storage or make hook-specific calls directly; switching implementations should be limited to the deployment config and generated ABIs.

The protocol reserve supplies complete sets as pool liquidity. User liabilities are settled before any protocol remainder; seed gains or losses are borne by the reserve. Because liquidity removal is adapter-only, the adapter must unwind positions when trading closes and return the resulting LONG/SHORT inventory for QuantumRound to account for. Winning-market user outcome balances settle through the round's scalar payout; losing-market outcome inventory has no user payout and is burned or returned to the reserve. External LP-share accounting and fee claims are not part of v1.

`WaveV4ProposalMarket.sol` locally creates one bounded LONG/SHORT pool per proposal using the shared hook, routes complete-set buys/sells, unwinds positions after close, and returns outcome inventory to QuantumRound. Foundry tests cover multiple proposals and rounds sharing one hook, isolated per-pool TWAPs and trading windows, unregistered-pool rejection, the market lifecycle, and liability coverage. The deploy script mines the one shared hook address before broadcasting. Arc end-to-end integration, expanded solvency fuzzing, migration, deployment-config update, and production deployment remain separate gates.

Compatibility command: `forge test --match-path contracts/test/WaveHookCompatibility.t.sol --fork-url https://rpc.testnet.arc.io -vv`.

### Complete-set sell math (fixed)

**Bug.** The first adapter swapped the whole `longIn` into the pool and then counted `min(longConsumed, shortOut)` as matched complete sets. The consumed LONG is inside the pool, so it cannot be paired with the SHORT received; only LONG still held by the market can. Credits were therefore computed from tokens that could not legitimately be burned, and the accounting burned only the SHORT leg. The first buy path also forwarded only the swap output, not the LONG leg of the minted complete set, so buyers received about half of what they paid for.

**Fix.**
- Buy: `c` credits mint `c` complete sets to the market; the SHORT leg is swapped for LONG; the user receives `c * 1e12` LONG (the set's LONG leg) plus the swap output. SHORT buys are symmetric.
- Sell: only part of the input `x` is swapped. The adapter finds the smallest `x` whose output `s(x)` satisfies `s(x) >= amountIn - consumed(x)` by bisection on the exact single-range swap simulation (stops when the bracket is 1e6 raw units wide, so at most ~40 iterations). The leftover input then pairs with the received output. `QuantumRound` burns `floor(min(left, received) / 1e12)` credits' worth of both legs, mints those credits, and returns only the remainder (under 1e12 raw units of each token plus the solver's rounding) as dust.
- At p = 0.5, selling N LONG returns about N/2 credits (in credit units) less 0.3% fee and price impact. Buy-then-sell-all can never return more than was spent.

**Tests.** `WaveV4ProposalMarket.t.sol`: `test_SellLongAtHalfReturnsAboutHalfInCredits`, `test_SellShortAtHalfReturnsAboutHalfInCredits`, `test_BuyLongThenSellAllReturnsAtMostSpentAndNoLeftovers`, `test_BuyShortThenSellAllReturnsAtMostSpentAndNoLeftovers`, `testFuzz_RoundTripsNeverExtractValueAndStayBacked` (buy, partial sell, collapse, settle with random returns, solvency and full redemption), and `testFuzz_QuotesMatchExecution`. `QuantumRoundCompleteSet.t.sol` keeps the mock-market solvency fuzz with the new settlement semantics.

### Exact quotes

`quoteBuyLong`, `quoteBuyShort`, `quoteSellLong`, `quoteSellShort` are views on the adapter. They load `slot0`, liquidity and fee from the PoolManager and replay `Pool.swap` (`SwapMath.computeSwapStep`, per-word tick stepping, protocol-fee-adjusted swap fee) for the single position, so they equal execution to the unit. Buy quotes return total tokens received (including the complete-set leg). Sell quotes return `(creditsOut, longDust, shortDust)`. Frontends must use these quotes, with a slippage tolerance (for example 0.5%), as `minOut`; they must not use the constant-product formula for Phase B markets.

### Selection scale

`IProposalMarket.probabilityTwap` returns the final-window LONG probability TWAP in `[0, 1e18]`. `QuantumRound.collapse` selects the winner on it: a proposal must beat the status quo's TWAP by `EPSILON = 0.005` (0.5 percentage points); otherwise the status quo wins. A proposal whose probability TWAP is below `SPAM_THRESHOLD_PROBABILITY = 0.1` (and that did not win) has its bond slashed. 0.1 is above the 0.01 pool floor, so a deliberate dump is distinguishable from an idle market (0.5), and it is not so high that a legitimately unpopular proposal at 0.2-0.3 is punished. `ConstantProductMarket` derives probability as `price / (1 + price)` from its price TWAP. `Collapsed` now emits probabilities.

### Phase B deployment plan (not executed; awaiting approval)

**New:** `ProposalTokens` (the live one has clones, so its credit decimals are locked at 18, and Phase B needs 6 via `setCreditDecimals(6)` before the first clone), `WaveV4ProposalMarket`, `WaveHook` (one shared), `QuantumRound`, `Resolver` (immutable round), `WavefundVault` (immutable round and resolver).

**Reused:** `TestAsset` (tETH), `ProposerRegistry` (re-granted roles), `MockPriceOracle`, `QuantumLP` (re-granted role), PoolManager, USDC, the USDC/tETH pool.

**Order:**
1. `DeployPhaseB` forge script (to be written after approval; no USDC moves, so simulation works): `ProposalTokens`, `setCreditDecimals(6)`, market, round, resolver, vault.
2. `DeployWaveHook.s.sol`: mines the salt off-chain, deploys the hook through the CREATE2 factory and calls `market.setWaveHook`. The market owner is still the deployer.
3. `market.setQuantumRound(round)`, then `market.transferOwnership(round)`; `round.setResolver`.
4. Roles: `QUANTUM_ROUND_ROLE` for the new round on `ProposalTokens`, `ProposerRegistry` and `QuantumLP`, revoked on `ProposerRegistry` and `QuantumLP` for the old round; `KEEPER_ROLE` on round and vault; `VAULT_ROLE` for the vault on the round; `RESOLVER_ROLE` for the vault on the resolver; `QUANTUM_ROUND_ROLE` for the round on the vault. Revoke the old vault's `VAULT_ROLE` on the old round.
5. viem script (USDC moves): `setInitialLiquidityPerProposal`, approve and `addProtocolLiquiditySeed`, vault funding.
6. Verify all new contracts on Sourcify; update `SOURCES.md`.
7. Cutover: regenerate ABIs, update `current.json` and frontend config, switch keeper and demo scripts, then `npm run check:contracts`.

**USDC:** seed `initialLiquidityPerProposal` x 4 proposals (recommended 5 USDC each, 20 USDC, with most returning to the reserve after collapse), bonds 1 USDC per proposer x 3 (refunded unless slashed), vault test deposit about 5 USDC, gas under 1 USDC. About 27 USDC in total; the deployer holds about 57 USDC.

**Keeper and scripts:** `collapse` already calls `finalizeProposal` for every proposal, so no extra keeper transaction is needed, but the demo close script must call `collapse` after `tradingEnd` and before `settle`, check the market is finalised (pool liquidity zero), and read probabilities, not prices. `openRound` and `propose` cost about 1.5M gas each.
