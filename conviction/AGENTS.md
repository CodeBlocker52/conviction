# AGENTS.md — Wavefund Project Notes

## Deployed Contracts — Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| TestAsset (tETH) | `0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d` |
| ProposalTokens | `0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51` |
| ProposerRegistry | `0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346` |
| ConstantProductMarket | `0xF01045EaFaC5CeC441d2619D588a4E82E6eeB28E` |
| QuantumRound | `0x7c601921721658D7f00f6Ec1d61DABbBA77A7118` |
| Resolver | `0x509ECfd14076149d402BD843CebE4df3e7889259` |
| WavefundVault | `0xBd736f0617A408bDA29F6F44eae6B768a1087298` |
| QuantumLP | `0x9CFF913Fbc88bC6572C1D0B5820Ea9dd40d11d06` |
| USDC (predeploy) | `0x3600000000000000000000000000000000000000` |
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |

## Wallets
- Deployer/Admin: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`
- Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`
- Keys stored in `.env` as DEPLOYER_PK / KEEPER_PK (never commit `.env`)

## Key Decisions
- ConstantProductMarket uses Ownable (not AccessControl) — owner = QuantumRound
- USDC transfers in forge scripts fail due to Arc blocklist precompile simulation issue — use `cast send` for post-deploy funding
- `initialLiquidityPerProposal` is configurable (default 500 USDC, set to 5 USDC for testnet demo)
- All proposal/market state keyed by (roundId, proposalId) to avoid cross-round collisions
- SHORT positions are real ERC-20 tokens (minted by QuantumRound, not the market)
- `via_ir = true` in foundry.toml required to avoid stack-too-deep in ProposalTokens

## Arc Testnet Notes
- RPC: https://rpc.testnet.arc.io
- Explorer: https://explorer.testnet.arc.io
- USDC: 6 decimals via ERC-20 interface
- Blocklist precompile 0x1800...0001 causes `StackUnderflow` in forge simulation; use `--skip-simulation` or `cast send` for USDC transfers
- Uniswap v4 is RC2 deployment (Peach testnet) — compatible with v4-core 1.0.2 npm package

## Phase Progress
- [x] Phase A: Core contracts deployed
- [ ] Phase A: Frontend wiring (plain viem + useWallet hook)
- [ ] Phase B: WaveHook (Uniswap v4 hook per proposal)
- [ ] Phase B: Full keeper automation

## Next Steps (Phase A frontend wiring)
1. Create `app/hooks/useWallet.ts` — plain viem with window.ethereum
2. Create `app/hooks/useQuantumRound.ts` — read/write QuantumRound via publicClient/walletClient
3. Replace `app/demo-context.tsx` simulation reads with real contract calls
4. Keep mock toggle in demo UI
