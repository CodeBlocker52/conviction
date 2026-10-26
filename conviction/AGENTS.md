# AGENTS.md — Wavefund Project Notes

**Current deployment = Phase B.** The single source of truth is `contracts/deployments/current.json` (mirrored in `contracts/deployments/SOURCES.md`). Phase A contracts are **superseded**: never send transactions to, fund, or wire the frontend/scripts to them.

## Deployed Contracts — Phase B, Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| QuantumRound | `0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5` |
| WaveV4ProposalMarket (adapter, `market`) | `0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A` |
| WaveHook (shared, one pool per proposal) | `0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0` |
| ProposalTokens (credits 6 decimals) | `0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E` |
| Resolver | `0x74Fdf9F04589A9FE558D6F9D39D996b4FB4E9a48` |
| WavefundVault | `0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865` |
| ProposerRegistry (reused) | `0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346` |
| MockPriceOracle (reused) | `0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d` |
| TestAsset tETH (reused) | `0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d` |
| QuantumLP (reused, not wired into Phase B markets) | `0x885512902D1f5d05f81A678FdFFE0e339623c415` |
| v4 callback (owns the USDC/tETH position) | `0xFaDBe81aF357757d2cd84e33883fe41579f88c97` |
| USDC (predeploy) | `0x3600000000000000000000000000000000000000` |
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

Phase B contracts are verified on the Arc explorer (Blockscout). Superseded Phase A addresses (QuantumRound `0x82a6…`, ConstantProductMarket `0xEC6d…`, old vaults) are listed only in `SOURCES.md` under "superseded".

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
- `npm run oracle:update | oracle:start | oracle:stop`.
- `npm run e2e:live [-- --url <site>]` — Playwright check of the deployed site (live and mock mode).
- `npm run build`, `npx tsc --noEmit`.

## Phase progress
- [x] Phase A deployed and superseded
- [x] Phase B contracts deployed, wired, verified and smoke-tested (see `contracts/deployments/demo-round.md`)
- [x] Frontend cut over to Phase B (live Markets, Vault, Portfolio, Agents, round states, real quotes)
- [x] RPC rate-limit hardening (multicall, fallback transport, backoff, stale notice)
- [ ] Decision-quality page (what each proposal would have returned)
- [ ] AI agents as proposers; full keeper automation; external LP shares (roadmap)
