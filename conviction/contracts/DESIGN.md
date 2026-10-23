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
| Keeper | Opens rounds, collapses, calls reportReturn | QuantumRound, WavefundVault |
| Resolver | Submits realised vault return | Resolver |
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

## Price Discovery (Phase A)
Each proposal uses a constant-product market (x*y=k) where:
- x = credit reserve (USDC units)
- y = LONG reserve (token units)
- Initial price = 0.5 (equal split at seeding)
- Fee = 0.3% (30 bps)
- TWAP accumulates: price * elapsed_seconds, updated on each trade

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
- When a non-status-quo winner is selected, keeper calls executeTrade(roundId, winnerTEthBps)
- Vault swaps on Uniswap v4 USDC/tETH pool (no hook, fee=3000, tickSpacing=60) to hit target allocation
- After evaluation period, keeper calls reportReturn() which reads current vault NAV and computes realisedReturn

Phase A includes a `setMockPrice` override so the demo can run without a live Uniswap pool.

## Contract Dependencies
```
QuantumRound
  ├── ProposalTokens (clone factory for CREDIT/LONG/SHORT tokens)
  ├── ConstantProductMarket (IProposalMarket — Phase A AMM)
  └── ProposerRegistry (bond custody)

Resolver → QuantumRound.settle()

WavefundVault
  ├── IPoolManager (Uniswap v4, 0x2756...)
  └── Resolver.submitReturn()
```

## Key Constants
| Name | Value | Notes |
|---|---|---|
| DEFAULT_BOND | 1 USDC | Proposer bond |
| initialLiquidityPerProposal | 5 USDC (testnet) / 500 USDC (prod) | Per-proposal market seed |
| SPAM_THRESHOLD_PRICE | 0.2e18 | TWAP below this = bond slashed |
| EPSILON | 0.005e18 | Winner margin above status quo |
| MAX_PROPOSALS_PER_ROUND | 20 | Gas safety cap |
| EMERGENCY_SETTLE_DELAY | 2 days | Permissionless settle fallback |

## Phase B Roadmap
1. WaveHook.sol: custom Uniswap v4 hook per proposal, replacing ConstantProductMarket
2. IProposalMarket interface unchanged — QuantumRound only calls tradeBuyLong/tradeSellLong/etc.
3. WaveHook encodes permissions in address low bits (requires CREATE2 salt mining)
4. Keeper becomes a full onchain agent with gas-abstracted execution
