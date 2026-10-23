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

## Pending Price-Control Upgrade
The addresses above are the existing Phase A deployment and do **not** implement the current source changes. No deployment, role grant, oracle update, funding, or demo-round transaction has been sent for this upgrade.

The updated contracts require redeployment of `QuantumRound` (10-proposal limit, cancellation/refunds, and unallocated-seed rescue), `ConstantProductMarket` (ownership is held by the old round), `Resolver` (immutable old round), `WavefundVault` (oracle NAV and 500 bps slippage protection), `QuantumLP` (withdrawals are now always available to the recorded provider), and a new `MockPriceOracle`. `TestAsset`, `ProposalTokens`, and `ProposerRegistry` may be reused after verifying their roles and state; Arc's USDC and v4 PoolManager remain external dependencies. ProposalTokens and ProposerRegistry reference the round only through roles, so the script revokes the legacy round's roles and grants roles to the new round. The old QuantumLP had zero LP balances and zero USDC; its withdrawal toggle was false, and no round lifecycle code ever enabled it. The new QuantumLP removes that uncalled global gate. The old `QuantumRound`'s 10 USDC protocol seed has no rescue path in its deployed source and remains locked by approval.

The deployment script also revokes the legacy round's keeper/admin permissions and its roles on the legacy LP, and removes the old resolver's keeper submission role. Its preflight rejects a legacy round with any opened rounds or an LP with funds. It uses the verified existing addresses in this file, so no extra address variables are needed in `.env`; only `DEPLOYER_PK` and `KEEPER_ADDR` are required to deploy. The new market seed is computed from 85% of the deployer's live USDC balance divided across the 10 proposal slots. For the demo, fund the new vault with 2 USDC from the remaining balance and keep the rest for fees and follow-up transactions. After deployment, set `NEW_QUANTUM_ROUND_ADDRESS`, `NEW_WAVEFUND_VAULT_ADDRESS`, and optionally `ARC_RPC_URL`, then run `node --env-file=.env contracts/script/seed-protocol.mjs --vault-funding-usdc=2` to set the final per-proposal amount, fund the seed, and fund the vault via the real RPC.

Oracle updater prerequisites: set `MOCK_PRICE_ORACLE_ADDRESS`, `KEEPER_PK`, and optionally `ARC_RPC_URL`, then run `node --env-file=.env contracts/script/update-oracle.mjs --watch` to publish every 60 seconds. Run it immediately before NAV marks and resolutions as well. `KEEPER_PK` must be authorized on the newly deployed oracle.

## Arc Testnet Oracle Check
Arc's [oracle ecosystem documentation](https://docs.arc.io/arc/tools/oracles.md) lists Chainlink, Pyth, RedStone, and Stork as providers. The latest provider documentation check did not confirm a ready-to-read ETH/USD feed on Arc Testnet:
- Pyth's [EVM contract address list](https://docs.pyth.network/price-feeds/core/contract-addresses/evm) showed an Arc mainnet deployment, but no Arc Testnet deployment.
- Stork's [EVM contract address list](https://docs.stork.network/resources/contract-addresses/evm.md) lists a contract on Arc Testnet, but its API requires a feed ID and signed updates; no current ETH/USD feed ID/value with a fresh onchain update was verified.
- Chainlink's [feed address directory](https://docs.chain.link/data-feeds/price-feeds/addresses) and RedStone's [feed dashboards](https://app.redstone.finance/push-feeds) did not provide a verified Arc Testnet ETH/USD contract.

The deployment therefore uses `MockPriceOracle` as the explicitly centralized fallback. It stores the keeper's 8-decimal Coinbase ETH/USD quote onchain and timestamps it at update time. Keep the updater running every 60 seconds and refresh immediately before NAV marks and resolution; the 5-minute contract freshness check is a hard upper bound, not the target cadence.

The new keeper-updated oracle reads Coinbase's public ETH/USD spot endpoint and submits an 8-decimal answer. The contract stamps `updatedAt` on-chain, so the service operator must call `contracts/script/update-oracle.mjs` promptly after fetching the quote. This is a centralized testnet fallback, not a decentralized price feed.
