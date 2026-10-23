# Wavefund Phase A — Deployed Addresses and Sources

## Chain
Arc Testnet, chain ID 5042002  
Explorer: https://explorer.testnet.arc.io  
RPC: https://rpc.testnet.arc.io

## Deployed Contracts (Phase A)
Deployer/Admin: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`  
Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`  
Deployed: 2026-10-22 via `forge script Deploy.s.sol --legacy --gas-price 25gwei`

| Contract | Address | Source File |
|---|---|---|
| TestAsset (tETH) | `0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d` | contracts/src/TestAsset.sol |
| ProposalTokens | `0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51` | contracts/src/ProposalTokens.sol |
| ProposerRegistry | `0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346` | contracts/src/ProposerRegistry.sol |
| ConstantProductMarket | `0xF01045EaFaC5CeC441d2619D588a4E82E6eeB28E` | contracts/src/ConstantProductMarket.sol |
| QuantumRound | `0x7c601921721658D7f00f6Ec1d61DABbBA77A7118` | contracts/src/QuantumRound.sol |
| Resolver | `0x509ECfd14076149d402BD843CebE4df3e7889259` | contracts/src/Resolver.sol |
| WavefundVault | `0xBd736f0617A408bDA29F6F44eae6B768a1087298` | contracts/src/WavefundVault.sol |
| QuantumLP | `0x9CFF913Fbc88bC6572C1D0B5820Ea9dd40d11d06` | contracts/src/QuantumLP.sol |

## Existing Contracts (Arc Testnet)

| Contract | Address | Source |
|---|---|---|
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` | Official Arc docs (arc.io/references/contract-addresses) — 6 decimal ERC-20 interface |
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` | Peach testnet RC2 docs. Verified: `cast call 0x87Dd..."poolManager()(address)"` returns this address |
| Uniswap v4 PositionManager | `0x87Dd714940ea540c921a92216e6E0DE1E2b1735C` | Peach testnet RC2 docs |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Standard canonical address. Verified: has code on Arc testnet |

## Verification Notes
- PoolManager `0x2756...`: confirmed by calling `PositionManager(0x87Dd...).poolManager()` which returns `0x2756...`
- `unlock(bytes)` call to `0x2756...` reverted with error code 3 (PoolManagerNotInitialized or similar) — expected behavior when no pool exists yet
- `poolManager()` on `0x6049...` (Arc mainnet PositionManager) returns `0x8366...` (mainnet PM), confirming `0x6049` is mainnet, not testnet

## Arc-Specific Notes
- USDC ERC-20 interface: 6 decimals. Native USDC gas asset: 18 decimals. Do NOT mix.
- All contract accounting uses the ERC-20 interface (6 decimals).
- Arc blocklist precompile at `0x1800000000000000000000000000000000000001` causes forge script simulation to fail on USDC transferFrom. Use `cast send` for post-deploy USDC transfers. Deploy script works when no USDC transfers in the broadcast batch.
- Arc EVM: Osaka baseline (EIP-3855 PUSH0 supported). Contracts compiled with `evm_version = "osaka"`, `solc_version = "0.8.26"`, `via_ir = true`.

## v4-core Version
Compiled against `@uniswap/v4-core@1.0.2` (npm).  
Arc testnet PoolManager is RC2; structural compatibility confirmed (unlock/swap/modifyLiquidity interface matches v4-core 1.0.x).

## Post-Deploy Seeding
QuantumRound seeded with 10 USDC (transaction 0x8611a633d13178e52cf2b79c90103d32dea8db1550894dc4183a922eeb796f84)  
initialLiquidityPerProposal = 5 USDC (set via setInitialLiquidityPerProposal; default 500 USDC, reduced for testnet demo)
