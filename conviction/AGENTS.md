# AGENTS.md — Wavefund Project Notes

**Current deployment = Phase B v2** (per-proposal credit claims). The single source of truth is `contracts/deployments/current.json` (mirrored in `contracts/deployments/SOURCES.md`). Phase A contracts are **superseded**: never send transactions to, fund, or wire the frontend/scripts to them.

## Deployed Contracts — Phase B v2, Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| QuantumRound | `0xc60ce44f777A0Cf0981AF2aF70f42ded2f80Aa9A` |
| WaveV4ProposalMarket (adapter, `market`) | `0xC32e0b3d5b49Cbd66dce5b97E616Ddbfc3681159` |
| WaveHook (shared, one pool per proposal) | `0xeb0929eba8be7abD3231b0D14Fa8F782B578cac0` |
| ProposalTokens (credits 6 decimals) | `0xB5c884d76a29A7dA7B290d14BB8616E4CFB32884` |
| Resolver | `0x20932A078D333A3A628E32f20C79105D914d3506` |
| WavefundVault | `0x3AdB8d5D0732Af22B64Cd63Bf15569B06332e137` |
| ProposerRegistry (reused) | `0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346` |
| MockPriceOracle (reused) | `0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d` |
| TestAsset tETH (reused) | `0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d` |
| QuantumLP (reused, not wired into Phase B markets) | `0x885512902D1f5d05f81A678FdFFE0e339623c415` |
| v4 callback (owns the USDC/tETH position) | `0xFaDBe81aF357757d2cd84e33883fe41579f88c97` |
| USDC (predeploy) | `0x3600000000000000000000000000000000000000` |
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

Phase B v2 contracts are verified on the Arc explorer (Blockscout). **Superseded:** the first Phase B deployment (QuantumRound `0x74b7…`, vault `0xA1E3…`, hook `0xA2FD…`, market `0x5A2D…`, tokens `0xA399…`, resolver `0x74Fd…`) was emptied and its reserve rescued; 5 USDC (round 3's seed) is permanently locked there. Never use it. Superseded Phase A addresses (QuantumRound `0x82a6…`, ConstantProductMarket `0xEC6d…`, old vaults) are listed only in `SOURCES.md` under "superseded".

## Wallets
- Deployer/Admin: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`
- Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`
- Keys live in `.env` (`DEPLOYER_PK`, `KEEPER_PK`, `BLOCKSCOUT_API_KEY`). Never commit or print `.env` values.

## Key rules
- USDC is 6 decimals (ERC-20 view); credits are 6; LONG, SHORT, WAVE and tETH are 18. Arc's native gas balance is an 18-decimal view of the same USDC — never add it to the ERC-20 balance.
- Forge simulation fails on USDC transfers (Arc blocklist precompile). Use forge only for builds, tests and deployments without USDC transfers; move USDC with viem/`cast send` against the real RPC.
- No wagmi. The frontend uses plain viem, EIP-6963 wallet discovery and a `useWallet` hook. Reads use Multicall3 batching and a wallet-first fallback transport (`NEXT_PUBLIC_ARC_RPC_URL` overrides the public RPC).
- Gas policy for broadcasts: priority fee 1 gwei, max fee about 2× the current base fee (Arc has been seen up to ~290 gwei).
- Markets: each proposal has a Uniswap v4 hook pool with liquidity only in the 0.01–0.99 probability range and complete-set mint/redeem. pLong is bounded and complementary; trades use the adapter's `quoteBuyLong/BuyShort/SellLong/SellShort` with 0.5% slippage.
- Claims: each proposal's credits are capped at the user's deposit **independently** (a 1 USDC deposit can claim 1 credit in every proposal). Redemption = `deposit − claimed[winner] + winner credits + LONG × π + SHORT × (1 − π)`; positions in erased proposals never reduce it.
- Status quo wins = the vault does not trade (it only processes queued deposits and withdrawals). Proposal 0's `tEthBps` is the vault's current allocation (`allocationSource`).
- `releaseSeed(roundId)` (permissionless) returns the winning seed once a round is settled or cancelled and no user liabilities remain; settle calls it automatically when nobody deposited.
- Winner selection uses the final-window probability TWAP (0–1); a proposal must beat the status quo by 0.005. All bonds (1 USDC, constant) are refunded at collapse; price-based slashing is roadmap work.
- Implied return = `rMin + pLong × (rMax − rMin)`, shown as a percentage change. Settled payout per LONG is π credits and per SHORT 1 − π, where π = (clamped return − rMin)/(rMax − rMin).
- Vault: deposits/withdrawals queue as WAVE shares and process at the next `executeTrade`. A 500 bps oracle-relative slippage breach cancels the round (all deposits redeem at par). Seed returns to the protocol reserve through collapse and settlement.
- `protocolLiquiditySeed` must cover 5 USDC × 4 markets per round. QuantumLP is not part of Phase B; external LP shares are roadmap.
- Oracle: keeper-updated `MockPriceOracle` (8 decimals, 5-minute max age). The watcher updates every 60 s only while a round is open.
- Arc Uniswap v4 is v4-core 1.0.2-compatible. `HookMiner` is used only by the hook deployment script.
- Do not change deployed addresses, open rounds, or spend USDC beyond what the user approved.

## Operating commands (run from `conviction/`)
- `npm run check:contracts` — code at every address, ABI selectors, linkage, roles, `creditDecimals == 6`.
- `npm run pool:recenter [-- --execute]` — re-centre the ±20% concentrated position on the oracle price (`-- --remove --execute` recovers it).
- `npm run demo:open-round -- --minutes 30 --execute` — open a round with three proposals and start the oracle watcher (`--test` relaxes the pool checks).
- `npm run demo:close-round -- --execute` — collapse, execute the vault trade, wait for evaluation, settle, stop the watcher.
- `npm run keeper:run [-- --poll 15 --open-every <min> --window <min>]` — keeper service: collapses at trading end, runs the vault trade immediately, reports and settles at evaluation end, optionally opens the next round, runs the oracle watcher while a round is active, logs every tx, stops cleanly on Ctrl+C. Needs `KEEPER_PK`.
- `npm run oracle:update | oracle:start | oracle:stop`.
- `npm run e2e:live [-- --url <site>]` — Playwright check of the deployed site (live and mock mode).
- `npm run build`, `npx tsc --noEmit`.

## Phase progress
- [x] Phase A deployed and superseded
- [x] Phase B contracts deployed, wired, verified and smoke-tested (see `contracts/deployments/demo-round.md`)
- [x] Frontend cut over to Phase B (live Markets, Vault, Portfolio, Agents, round states, real quotes)
- [x] RPC rate-limit hardening (multicall, fallback transport, backoff, stale notice)
- [ ] Decision-quality page (what each proposal would have returned)
- [x] Phase B v2 redeploy (per-proposal claims, seed release, status-quo no-trade), smoke rounds A and B, `keeper:run`
- [ ] AI agents as proposers; external LP shares (roadmap)
