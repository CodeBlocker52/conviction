# AGENTS.md — Wavefund Project Notes

## Deployed Contracts — Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| TestAsset (tETH) | `0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d` |
| ProposalTokens | `0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51` |
| ProposerRegistry | `0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346` |
| ConstantProductMarket | `0xEC6d767c62029A2868E1475873D9C2aE172F72df` |
| QuantumRound | `0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41` |
| Resolver | `0xeA89585fb62e6eB63D101409093D88A94A936A4C` |
| WavefundVault | `0x65648366C96Af7b3c2ECdC1B78A06d975A1505F3` |
| QuantumLP | `0x885512902D1f5d05f81A678FdFFE0e339623c415` |
| MockPriceOracle | `0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d` |
| USDC (predeploy) | `0x3600000000000000000000000000000000000000` |
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |

## Wallets
- Deployer/Admin: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`
- Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`
- Keys stored in `.env` as DEPLOYER_PK / KEEPER_PK (never commit `.env`)

## Key Decisions
- ConstantProductMarket uses Ownable (not AccessControl) — owner = QuantumRound
- USDC transfers in forge scripts fail due to Arc blocklist precompile simulation issue — use `cast send` for post-deploy funding
- `initialLiquidityPerProposal` is configurable; the upgrade script allocates 85% of available USDC across all 10 proposal slots, funds the demo vault with the selected amount, and preserves the rest for fees/follow-up
- No live Arc Testnet ETH/USD feed was confirmed; current source uses keeper-updated `MockPriceOracle` (8 decimals) with a 5-minute maximum age. The managed oracle watcher updates every 60 seconds only while a round is active
- Vault trade output has a 500 bps adverse-slippage cap; a breach reverts the nested swap and cancels the round for full deposit refunds
- `MAX_PROPOSALS_PER_ROUND` is 10 total proposals, including status quo proposal 0
- On a fresh deployment, grant `RESOLVER_ROLE` to WavefundVault, `VAULT_ROLE` on QuantumRound to the vault, and `QUANTUM_ROUND_ROLE` on the vault to QuantumRound; do not grant `RESOLVER_ROLE` to the keeper
- QuantumRound admin rescue is capped by unallocated `protocolLiquiditySeed`; round-allocated seed and user deposits cannot be rescued
- QuantumLP no longer has a global withdrawal toggle; providers can withdraw their own LP balance at any time
- All proposal/market state keyed by (roundId, proposalId) to avoid cross-round collisions
- SHORT positions are real ERC-20 tokens (minted by QuantumRound, not the market)
- `via_ir = true` in foundry.toml required to avoid stack-too-deep in ProposalTokens

## Arc Testnet Notes
- RPC: https://rpc.testnet.arc.io
- Explorer: https://explorer.testnet.arc.io
- USDC: 6 decimals via ERC-20 interface
- tETH uses 18 decimals; vault oracle prices are converted to 6-decimal USDC base units per 1e18 tETH
- Blocklist precompile 0x1800...0001 causes `StackUnderflow` in forge simulation; use `--skip-simulation` or `cast send` for USDC transfers
- Uniswap v4 is RC2 deployment (Peach testnet) — compatible with v4-core 1.0.2 npm package

## Phase Progress
- [x] Phase A: Current core contracts deployed and v4 USDC/tETH smoke-tested
- [ ] Phase A: Frontend wiring (plain viem + useWallet hook)
- [ ] Phase B: WaveHook (Uniswap v4 hook per proposal)
- [ ] Phase B: Full keeper automation

## Operating commands
- One-shot oracle update: `npm run oracle:update`
- Start active-round watcher: `npm run oracle:start`
- Stop active-round watcher: `npm run oracle:stop`
- The watcher pauses updates unless the latest round exists and is neither settled nor canceled.
- Proposal bond is `1 USDC` (`DEFAULT_BOND` is a constant, with no admin setter); do not change deployment state to lower it.
- Keep USDC transfers and other write operations on the real Arc RPC, never Forge's local simulation.
- Frontend uses plain viem and `window.ethereum`; do not add wagmi.
