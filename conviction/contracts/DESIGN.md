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
| LP | Deposits USDC into QuantumLP (stub in Phase A) | QuantumLP |

## Round Lifecycle

```
openRound()
    → proposal 0 (status quo) auto-created
    → market seeded with initialLiquidityPerProposal USDC

propose()               [any registered proposer, during trading window]
    → bond locked
    → credit/LONG/SHORT tokens deployed for proposal
    → market seeded

deposit(amount)         [any forecaster, during trading window]
    → USDC held by QuantumRound

claimCredits(proposalId, amount)  [forecaster, during trading window]
    → credits minted 1:1 from deposit
    → aggregate cap: sum(claimed) ≤ deposit

buyLong / sellLong / buyShort / sellShort   [during trading window]
    → route through ConstantProductMarket (x*y=k, 0.3% fee)
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

Admin may rescue only `protocolLiquiditySeed`, which is reduced when a proposal market is allocated. User deposits remain accounted for per round, and seed allocated to an existing round is not rescuable. QuantumLP is a Phase A custody stub; providers can always withdraw their own recorded balance. Its former global withdrawal toggle had no round lifecycle caller and is removed.

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

Phase B replaces this with Uniswap v4 hook pools (WaveHook.sol).

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
| SPAM_THRESHOLD_PRICE | 0.2e18 | TWAP below this = bond slashed |
| EPSILON | 0.005e18 | Winner margin above status quo |
| MAX_PROPOSALS_PER_ROUND | 10 | Includes status quo proposal 0 |
| EMERGENCY_SETTLE_DELAY | 2 days | Permissionless settle fallback |
| MAX_ORACLE_AGE | 5 minutes | Maximum age accepted at trade execution/reporting |
| maxSlippageBps | 500 | Maximum adverse swap slippage relative to oracle output |

## Phase B Roadmap
1. WaveHook.sol: custom Uniswap v4 hook per proposal, replacing ConstantProductMarket
2. IProposalMarket interface unchanged — QuantumRound only calls tradeBuyLong/tradeSellLong/etc.
3. WaveHook encodes permissions in address low bits (requires CREATE2 salt mining)
4. Keeper becomes a full onchain agent with gas-abstracted execution

### Phase B compatibility spike

The minimal `WaveHook` compatibility spike uses the existing Arc testnet PoolManager and v4-core 1.0.2 interfaces. Its required address flags are `beforeAddLiquidity`, `beforeRemoveLiquidity`, `beforeSwap`, and `afterSwap`; `HookMiner` must find a CREATE2 address whose low 14 bits match those flags. The hook allows those operations only from its configured adapter and during the round's trading window. Liquidity positions must stay within ticks `[-45900, 45900]`, corresponding to the intended probability range near 0.01–0.99 at tick spacing 60. `afterSwap` records the price-time integral for the configured final TWAP window.

For a LONG/SHORT pool, let `q` be the pool's marginal quote of SHORT tokens per LONG token. If LONG is currency0, `q = sqrtPriceX96² / 2¹⁹²`; if LONG is currency1, invert that ratio. The displayed probability is `pLong = q / (1 + q)`, and `pShort = 1 - pLong`. Therefore the probability boundaries 0.01 and 0.99 correspond to `q = 1/99` and `q = 99`, respectively. The UI's scalar implied return is `rMin + pLong × (rMax − rMin)`; it must show this bounded value separately from the execution quote for the requested trade.

Phase B buy/sell accounting uses explicit units: one credit is 1 USDC-denominated credit (`1e6` raw units), while one LONG or SHORT is `1e18` raw token units. The existing clone implementation reports 18 decimals for all three token types even though credits are accounted in USDC base units; Phase B must either expose 6 decimals for CREDIT clones or consistently normalize the credit scale at every contract and frontend boundary. Buying LONG burns one credit to mint a complete set (one LONG plus one SHORT), then swaps the SHORT side for additional LONG through the v4 pool, with the adapter enforcing the bounded price limit. Selling LONG swaps it into SHORT, redeems matched LONG/SHORT complete sets for credits, and returns any unmatched outcome-token remainder to the seller. SHORT trades use the symmetric path. Any implementation must preserve the same minimum-output/slippage guarantees.

The Phase B market adapter must preserve the current `IProposalMarket` entry points for QuantumRound and expose the same UI-facing price, quote, and TWAP reads through one market address/ABI. The frontend must not read PoolManager storage or make hook-specific calls directly; switching implementations should be limited to the deployment config and generated ABIs.

Protocol seed or `QuantumLP` supplies complete sets as pool liquidity. Because liquidity removal is adapter-only and trading-window-only, the adapter must unwind LP positions before the trading window closes and escrow the resulting LONG/SHORT inventory for settlement. For the winning proposal, the escrowed outcome balances settle through the round's scalar payout; LP inventory in losing proposals has no payout and is recorded as a loss. LP-share accounting must distribute the post-settlement assets and fees without allowing one proposal's pool to claim another proposal's collateral.

The initial compatibility test is deliberately not the production market adapter. It verifies a mined hook can initialize a LONG/SHORT pool, add liquidity only within the configured tick range, perform a bounded swap, and update the final-window accumulator against the deployed Arc PoolManager. Full market integration, complete-set mint/redeem, LP accounting, migration, and deployment remain separate steps.

Compatibility command: `forge test --match-path contracts/test/WaveHookCompatibility.t.sol --fork-url https://rpc.testnet.arc.io -vv`.
