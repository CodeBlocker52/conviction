# AGENTS.md — Wavefund Project Notes

**Current deployment = fresh Arc Testnet redeployment** (per-proposal credit claims). The single source of truth is `contracts/deployments/current.json` (mirrored in `contracts/deployments/SOURCES.md`). Earlier deployments remain history only: never send transactions to, fund, or wire the frontend/scripts to them.

## Deployed Contracts — fresh deployment, Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| QuantumRound | `0x9E4aD1833F16C3dc6B6b18708aE086fa003e8dEF` |
| WaveV4ProposalMarket (adapter, `market`) | `0x77320698947AeB2EF5B740fa893f6358EBe1C034` |
| WaveHook (shared, one pool per proposal) | `0xc40F5F9F856eF0b64bC3fDc0AE8837CAac4c8ac0` |
| ProposalTokens (credits 6 decimals) | `0x14CE21b275616c46EBfe45e19b03f1a61cbbf208` |
| Resolver | `0x33CA9beAEEA9f44457C6ff4FAfB694177cC55252` |
| WavefundVault | `0x2ba9271420082d05373282a9c6EFcB416acf799f` |
| ProposerRegistry | `0x113120Cf3D8f55d155e069E5952A2aFa5E94b012` |
| MockPriceOracle | `0x394E1E7609a9a8E8AB60d359f77960afC488D78c` |
| TestAsset tETH | `0xDeA9A56A10BCFbd86717fb5Dd58e2eb52255688f` |
| WavefundPriceReceiver (simulation forwarder) | `0xcf4edC109B47BeF93Ad27e72C8DD906A5c94838e` |
| v4 callback (owns the USDC/tETH position) | `0xf50B32E596f98e52cE5BC656d8a8C94372e6A757` |
| USDC (predeploy) | `0x3600000000000000000000000000000000000000` |
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

New registry starts empty; the three configured proposer agents register themselves on their first proposal run. Forecasters do not use the proposer registry. `QuantumLP` is not part of this deployment and remains historical only. The CRE receiver uses simulation forwarder `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1`, selector `3034092155422581607`, and transmitter `0xa2A470207A21f957e3c0223d77fb4B46fb32b8d8`; production workflow identity checks are still required. Earlier deployments and rounds are documented in `contracts/deployments/SOURCES.md` and `contracts/deployments/demo-round.md`.

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
- `protocolLiquiditySeed` must cover `initialLiquidityPerProposal × (1 + active proposer agents)`. The current value is 5 USDC per market; three proposers require 20 USDC, covered by the 30 USDC reserve. QuantumLP is historical and not wired into the current deployment.
- Oracle: keeper-updated `MockPriceOracle` (8 decimals, 5-minute max age). The watcher updates every 60 s only while a round is open.
- Arc Uniswap v4 is v4-core 1.0.2-compatible. `HookMiner` is used only by the hook deployment script.
- Do not change deployed addresses, open rounds, or spend USDC beyond what the user approved.

## Operating commands (run from `conviction/`)
- `npm run check:contracts` — code at every address, ABI selectors, linkage, roles, `creditDecimals == 6`.
- `npm run pool:recenter [-- --execute]` — re-centre the ±20% concentrated position on the oracle price (`-- --remove --execute` recovers it).
- `npm run pool:init` — initialize the fresh USDC/tETH v4 pool at the fresh on-chain oracle price.
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
- [x] Phase B v2 redeploy and its completed rounds (historical; see `contracts/deployments/demo-round.md`)
- [x] Fresh Arc Testnet redeployment, new registry/oracle/tETH, 30 USDC reserve, 5 USDC vault, concentrated pool and CRE simulation receiver
- [ ] AI agents as proposers; external LP shares (roadmap)
