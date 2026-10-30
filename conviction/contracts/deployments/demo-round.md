# Arc Testnet Demo Round

## Attempt 1

Status: Canceled by the vault slippage guard; deposits were refunded at par in Attempt 2.
Started: 2026-10-24T19:38:54.543Z
Deployer: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`
Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`

The 50% tETH winner required a 0.05 USDC vault swap. The pool output was 12.59% below the oracle-based expected output, exceeding the vault's 5% slippage cap. `executeTrade` safely canceled this round and rolled back the swap; the subsequent `reportReturn` call reverted with `RoundCancelled` and did not create a transaction. Both deposits were refunded in Attempt 2.

| Action | Transaction | Result |
|---|---|---|
| Approve USDC | [0x1e139aa5b41236805074cc2b6ff7351c38ca60d3e0ab8b6fbe5cf310cd50e5d7](https://explorer.testnet.arc.io/tx/0x1e139aa5b41236805074cc2b6ff7351c38ca60d3e0ab8b6fbe5cf310cd50e5d7) | Confirmed |
| Fund new vault with 0.1 USDC | [0x57703f8b87977d1d17da554a83c8fdc333e4d64f5e7710df47da461d0ecf7fc8](https://explorer.testnet.arc.io/tx/0x57703f8b87977d1d17da554a83c8fdc333e4d64f5e7710df47da461d0ecf7fc8) | Confirmed |
| Register Wavefund Deployer proposer | [0x8be4f90027d1f54450b7459b4b3eac414e82e78e7c64fda3b0af20538252cf33](https://explorer.testnet.arc.io/tx/0x8be4f90027d1f54450b7459b4b3eac414e82e78e7c64fda3b0af20538252cf33) | Confirmed |
| Register Wavefund Keeper proposer | [0x4624d8845612c659b55c6ec557bbcb6db07fa45e246fa8136cf6297b9357ac86](https://explorer.testnet.arc.io/tx/0x4624d8845612c659b55c6ec557bbcb6db07fa45e246fa8136cf6297b9357ac86) | Confirmed |
| Approve USDC | [0x95f4978a87bda5637cacdd8f5fddcafb4b033ec3829f082bd3617ff40d24b071](https://explorer.testnet.arc.io/tx/0x95f4978a87bda5637cacdd8f5fddcafb4b033ec3829f082bd3617ff40d24b071) | Confirmed |
| Approve USDC | [0x9f45a7f5e92e2a66ea91dac8fe6ae5e8973c959a63dc5537268ce5e757b982bc](https://explorer.testnet.arc.io/tx/0x9f45a7f5e92e2a66ea91dac8fe6ae5e8973c959a63dc5537268ce5e757b982bc) | Confirmed |
| Open round | [0x523084695d8695fa1249e69218a3d7cbfee5978b8462634969bbcce7073c13b9](https://explorer.testnet.arc.io/tx/0x523084695d8695fa1249e69218a3d7cbfee5978b8462634969bbcce7073c13b9) | Confirmed |
| Proposal 1 (deployer) | [0xacf686ce6ed44439c7d90987249af5a37460aa12bcce3601f652e2b2ee3baba0](https://explorer.testnet.arc.io/tx/0xacf686ce6ed44439c7d90987249af5a37460aa12bcce3601f652e2b2ee3baba0) | Confirmed |
| Proposal 2 (keeper) | [0xcc50a019173e13e385e81a449d4ec205b07fd102eb08899fa2132ff2697eb7a9](https://explorer.testnet.arc.io/tx/0xcc50a019173e13e385e81a449d4ec205b07fd102eb08899fa2132ff2697eb7a9) | Confirmed |
| Proposal 3 (deployer) | [0x21daa441a38abcdc793877d01e96cfdd64253a766b290016c37fb6a1fc533e00](https://explorer.testnet.arc.io/tx/0x21daa441a38abcdc793877d01e96cfdd64253a766b290016c37fb6a1fc533e00) | Confirmed |
| Approve USDC | [0x543b6805254f5f0e8bbbe415ce21d01d343ef41f44b7bca3ef985a8b684a4de1](https://explorer.testnet.arc.io/tx/0x543b6805254f5f0e8bbbe415ce21d01d343ef41f44b7bca3ef985a8b684a4de1) | Confirmed |
| Approve USDC | [0x6fdcb2a8b532553c7fdb2a4e0f5c30e90bd927bc7970b13a973d3f650423324f](https://explorer.testnet.arc.io/tx/0x6fdcb2a8b532553c7fdb2a4e0f5c30e90bd927bc7970b13a973d3f650423324f) | Confirmed |
| Deployer round deposit (1.5 USDC) | [0x91d5b1989d53edfa03b129ba68b9895c23d6813088daf4793d7ade265d618c7c](https://explorer.testnet.arc.io/tx/0x91d5b1989d53edfa03b129ba68b9895c23d6813088daf4793d7ade265d618c7c) | Confirmed |
| Keeper round deposit (1.5 USDC) | [0x090d1e47b2d3cfe93ea11fb9188fa7f6e8dd585e96886cb8c8ef538316d04982](https://explorer.testnet.arc.io/tx/0x090d1e47b2d3cfe93ea11fb9188fa7f6e8dd585e96886cb8c8ef538316d04982) | Confirmed |
| Deployer claims 1 USDC credits on proposal 1 | [0xeff0bce6e8d93fa391d738f639e229304433c4ecee965a03c6647397c0d6b681](https://explorer.testnet.arc.io/tx/0xeff0bce6e8d93fa391d738f639e229304433c4ecee965a03c6647397c0d6b681) | Confirmed |
| Keeper claims 0.5 USDC credits on proposal 1 | [0x7fb00bb61c34a785141a34638fbd070a1660fbb134dbc309923f90b21572b307](https://explorer.testnet.arc.io/tx/0x7fb00bb61c34a785141a34638fbd070a1660fbb134dbc309923f90b21572b307) | Confirmed |
| Deployer buys LONG with 1 USDC credits | [0xe5f74e75eb365e7b372ebf73f67bd19049c4635b33b870febbd390cdc231f8b8](https://explorer.testnet.arc.io/tx/0xe5f74e75eb365e7b372ebf73f67bd19049c4635b33b870febbd390cdc231f8b8) | Confirmed |
| Keeper buys SHORT with 0.5 USDC credits | [0x3530b2dae58b699cde3b6e914e49cae7574cb2b796448ec4b077e29474d7e898](https://explorer.testnet.arc.io/tx/0x3530b2dae58b699cde3b6e914e49cae7574cb2b796448ec4b077e29474d7e898) | Confirmed |
| Collapse round | [0x2c9208f9ac6a8a5428c7d42cc6b6b22cbdb828b60919595d6dccdf7b8d0f94bc](https://explorer.testnet.arc.io/tx/0x2c9208f9ac6a8a5428c7d42cc6b6b22cbdb828b60919595d6dccdf7b8d0f94bc) | Confirmed |
| Winner observed: proposal 1, 5000 bps tETH; proposal 1 spot 1673306965668276829 | — | On-chain read |
| Keeper oracle price update | [0x5f75fa8d29a9e50ea60bcf7b0226e6145cad3b2d022988aec04e5e2f8452e9b6](https://explorer.testnet.arc.io/tx/0x5f75fa8d29a9e50ea60bcf7b0226e6145cad3b2d022988aec04e5e2f8452e9b6) | Confirmed |
| WavefundVault executes winner allocation | [0xb87709c2f05cd3486ed447d079b326cad8a36b7d24b0a94dd8595cf148939bae](https://explorer.testnet.arc.io/tx/0xb87709c2f05cd3486ed447d079b326cad8a36b7d24b0a94dd8595cf148939bae) | Confirmed |
| Keeper oracle price update | [0xbfca3a1a7b84681585d3bfc1833fe02367082e00dd80b26ddce023fa1c186634](https://explorer.testnet.arc.io/tx/0xbfca3a1a7b84681585d3bfc1833fe02367082e00dd80b26ddce023fa1c186634) | Confirmed |

## Attempt 2

Status: Complete; round 2 settled and both users redeemed.
Started: 2026-10-24T19:47:48.473Z
Deployer: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`
Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`

This run uses the current QuantumRound and replacement share-enabled WavefundVault. Its 7.5% tETH target caused a confirmed 0.0075 USDC allocation swap through WavefundVault and Uniswap v4, not through the smoke-test callback. Round 2 settled at a 0.99655 realized-return ratio; both participants redeemed their deposits.

| Action | Transaction | Result |
|---|---|---|
| Deployer redeems canceled round 1 | [0xa567c21a90f2b1a3e08fc1c660b72fdd3b03718222a6da7177f862fab46b9f5b](https://explorer.testnet.arc.io/tx/0xa567c21a90f2b1a3e08fc1c660b72fdd3b03718222a6da7177f862fab46b9f5b) | Confirmed |
| Keeper redeems canceled round 1 | [0x7d488f686f2d29be8e04f50b30d359e480f015d24e5a15833464b6ee2e49c8bc](https://explorer.testnet.arc.io/tx/0x7d488f686f2d29be8e04f50b30d359e480f015d24e5a15833464b6ee2e49c8bc) | Confirmed |
| Approve USDC | [0x413d967174660d28a4e38cca9ec437ec8c4e8b5fb5bed55a3cbd6f1345c71d43](https://explorer.testnet.arc.io/tx/0x413d967174660d28a4e38cca9ec437ec8c4e8b5fb5bed55a3cbd6f1345c71d43) | Confirmed |
| Approve USDC | [0x9f0958bfe99b98af657b8dbd78ea9e0798893d05c01b8c786dd406c9165d250e](https://explorer.testnet.arc.io/tx/0x9f0958bfe99b98af657b8dbd78ea9e0798893d05c01b8c786dd406c9165d250e) | Confirmed |
| Open round | [0xe5cd623e3418d2f3c4d3cbf85c650ab35e25f7fd5b6a7b24b0b4a9cbff48496b](https://explorer.testnet.arc.io/tx/0xe5cd623e3418d2f3c4d3cbf85c650ab35e25f7fd5b6a7b24b0b4a9cbff48496b) | Confirmed |
| Proposal 1 (deployer) | [0x516258b7169ffb96158a64110be817edd450878b9d8d4d19bc102c280deecbf9](https://explorer.testnet.arc.io/tx/0x516258b7169ffb96158a64110be817edd450878b9d8d4d19bc102c280deecbf9) | Confirmed |
| Proposal 2 (keeper) | [0x0816894637a3ec5555d89eafba9b56ae159699cfb14c79d6aec38728e322b26d](https://explorer.testnet.arc.io/tx/0x0816894637a3ec5555d89eafba9b56ae159699cfb14c79d6aec38728e322b26d) | Confirmed |
| Proposal 3 (deployer) | [0x9014d74f7581860bc6123df4ee861a54c9448e6c391964567e4798b53d9d213d](https://explorer.testnet.arc.io/tx/0x9014d74f7581860bc6123df4ee861a54c9448e6c391964567e4798b53d9d213d) | Confirmed |
| Approve USDC | [0xd92a3d678fdd6e316d970ee053c4cc8d327bd4e4155ae6301f47b43f5bda1dd9](https://explorer.testnet.arc.io/tx/0xd92a3d678fdd6e316d970ee053c4cc8d327bd4e4155ae6301f47b43f5bda1dd9) | Confirmed |
| Approve USDC | [0x675f52e381f7ddc6d13a019179774dc28ab1f93c283a54d62b3943cc6669450a](https://explorer.testnet.arc.io/tx/0x675f52e381f7ddc6d13a019179774dc28ab1f93c283a54d62b3943cc6669450a) | Confirmed |
| Deployer round deposit (1.5 USDC) | [0x7b09ae2f69e1f394a8420c553926ba06d6daf86e9c90842a6c644d3df2d50fa8](https://explorer.testnet.arc.io/tx/0x7b09ae2f69e1f394a8420c553926ba06d6daf86e9c90842a6c644d3df2d50fa8) | Confirmed |
| Keeper round deposit (1.5 USDC) | [0xd20b758de3338ef601e0a014789d1c8c4dd1c680d767f5ecf81fcfa2a7d040cb](https://explorer.testnet.arc.io/tx/0xd20b758de3338ef601e0a014789d1c8c4dd1c680d767f5ecf81fcfa2a7d040cb) | Confirmed |
| Deployer claims 1 USDC credits on proposal 1 | [0x2ad8d96558c5565037705db847f934cbf9cf0d191bcbe29972d7e6847e1b8f2d](https://explorer.testnet.arc.io/tx/0x2ad8d96558c5565037705db847f934cbf9cf0d191bcbe29972d7e6847e1b8f2d) | Confirmed |
| Keeper claims 0.5 USDC credits on proposal 1 | [0xed7fcb5df59bd380cfaa58c3078103e181652fd94f2ac5657a98bcd2a1b01847](https://explorer.testnet.arc.io/tx/0xed7fcb5df59bd380cfaa58c3078103e181652fd94f2ac5657a98bcd2a1b01847) | Confirmed |
| Deployer buys LONG with 1 USDC credits | [0x87094b17799c928e0cd858864f72f8f494ef243dfe4249596fdb2a463d8978f1](https://explorer.testnet.arc.io/tx/0x87094b17799c928e0cd858864f72f8f494ef243dfe4249596fdb2a463d8978f1) | Confirmed |
| Keeper buys SHORT with 0.5 USDC credits | [0x8fd6746152c4726b7eb8321beadd8461c2b27172b8eb41a5888abe5981194847](https://explorer.testnet.arc.io/tx/0x8fd6746152c4726b7eb8321beadd8461c2b27172b8eb41a5888abe5981194847) | Confirmed |
| Collapse round | [0xde59cc9690960ec9ce16805881024954dccc9e8c5a9d4569dc221c253d2c1600](https://explorer.testnet.arc.io/tx/0xde59cc9690960ec9ce16805881024954dccc9e8c5a9d4569dc221c253d2c1600) | Confirmed |
| Winner observed: proposal 1, 750 bps tETH; proposal 1 spot 1673306965668276829 | — | On-chain read |
| Keeper oracle price update | [0x15876a45920410e6b84db667c60d194ddf6bb377a1bea493c55ad4da6cde76a9](https://explorer.testnet.arc.io/tx/0x15876a45920410e6b84db667c60d194ddf6bb377a1bea493c55ad4da6cde76a9) | Confirmed |
| WavefundVault executes 7.5% tETH allocation (0.0075 USDC swap) | [0xb68ecc76867e6841f86d47d804658f5572f84363a653a43694e54a447c8f3b04](https://explorer.testnet.arc.io/tx/0xb68ecc76867e6841f86d47d804658f5572f84363a653a43694e54a447c8f3b04) | Confirmed |
| Keeper oracle price update | [0x67a55ceaca4232d8182a17ab89eeec9884f875c6a5e6540fbad1f58d67a64982](https://explorer.testnet.arc.io/tx/0x67a55ceaca4232d8182a17ab89eeec9884f875c6a5e6540fbad1f58d67a64982) | Confirmed |
| WavefundVault marks NAV and Resolver settles round | [0x664e7bb63081bb6416c4a57df51cf8debdbd8b584f6bebbffb0db2d154b9a342](https://explorer.testnet.arc.io/tx/0x664e7bb63081bb6416c4a57df51cf8debdbd8b584f6bebbffb0db2d154b9a342) | Confirmed |
| Deployer redeems | [0x0e3e188cd5dd030d515285b406accd684782f205c85b0ad9219fc9c3742626d7](https://explorer.testnet.arc.io/tx/0x0e3e188cd5dd030d515285b406accd684782f205c85b0ad9219fc9c3742626d7) | Confirmed |
| Keeper redeems | [0x45a793e418fa3ccb8c85a503fc5cfe369346f91357361e6ed356d77454f49da9](https://explorer.testnet.arc.io/tx/0x45a793e418fa3ccb8c85a503fc5cfe369346f91357361e6ed356d77454f49da9) | Confirmed |
| Final state: round 2 settled=true, canceled=false, winner=1, return=996550000000000000, vault USDC=92500, tETH=3062520335899, WAVE supply=100000000000000000 | — | On-chain read |

## Managed keeper watcher transactions

These 60-second oracle watcher updates were confirmed during the two demo attempts. The entries adjacent to round opening/settlement include an in-flight watcher update around the lifecycle transition.

| Attempt | Time (UTC) | Transaction |
|---|---|---|
| 1 | 19:39:54 | [0x44782c2353bacc636e7c6a13f9bedc40fe4acd1b57b80b4e0ccdc9be630de916](https://explorer.testnet.arc.io/tx/0x44782c2353bacc636e7c6a13f9bedc40fe4acd1b57b80b4e0ccdc9be630de916) |
| 1 | 19:41:01 | [0x90b66bc378880b926ecabac6db5ad1a54be2c1fae14132af87efa4b8567b0bb1](https://explorer.testnet.arc.io/tx/0x90b66bc378880b926ecabac6db5ad1a54be2c1fae14132af87efa4b8567b0bb1) |
| 1 | 19:42:07 | [0x146d3b8116342b12ecd2cfd956d91bf630b5618448fb7c390fb9a07e2a9593a2](https://explorer.testnet.arc.io/tx/0x146d3b8116342b12ecd2cfd956d91bf630b5618448fb7c390fb9a07e2a9593a2) |
| 1 | 19:43:10 | [0x47b9a7562b060028f0191848270c3acf8497b7903649815a82a24f40cafd466d](https://explorer.testnet.arc.io/tx/0x47b9a7562b060028f0191848270c3acf8497b7903649815a82a24f40cafd466d) |
| 2 | 19:47:03 | [0xb8558645fd060a00096ade595749b5531b5baf39f04addcae083756f5be77614](https://explorer.testnet.arc.io/tx/0xb8558645fd060a00096ade595749b5531b5baf39f04addcae083756f5be77614) |
| 2 | 19:47:49 | [0x64ed2383237bfb2607ec0f7202fb441e61f41563c49c88cb8b249f2ec0f984e5](https://explorer.testnet.arc.io/tx/0x64ed2383237bfb2607ec0f7202fb441e61f41563c49c88cb8b249f2ec0f984e5) |
| 2 | 19:48:52 | [0x93e817da62cf9c35fb36403f05cc462954212381caea7dc03d3b1851148fdb30](https://explorer.testnet.arc.io/tx/0x93e817da62cf9c35fb36403f05cc462954212381caea7dc03d3b1851148fdb30) |
| 2 | 19:49:56 | [0x154f0ec84b63232d70167cb29c8b91ccf5549545f570feaa9c0a89a635b4594d](https://explorer.testnet.arc.io/tx/0x154f0ec84b63232d70167cb29c8b91ccf5549545f570feaa9c0a89a635b4594d) |
| 2 | 19:51:00 | [0x320ced994084846a30e1b3a01f41e5ece60cfc6e58be7056c349113efc2f09aa](https://explorer.testnet.arc.io/tx/0x320ced994084846a30e1b3a01f41e5ece60cfc6e58be7056c349113efc2f09aa) |
| 2 | 19:52:04 | [0x0e44a1968488fe55b475629e2e27ac432e908dcda09207612ca15d0b50f5c5b3](https://explorer.testnet.arc.io/tx/0x0e44a1968488fe55b475629e2e27ac432e908dcda09207612ca15d0b50f5c5b3) |


## Round 3 close (Phase A) and Phase B deployment

Round 3 was closed on the Phase A contracts with `demo-close-round.mjs --execute --yes`: winner proposal 0 (status quo), return ratio 0.998004632. No deposits existed, so no redemptions were needed.

| Step | Transaction |
|---|---|
| collapse | [0x9f1dd862…3e1b1a](https://explorer.testnet.arc.io/tx/0x9f1dd8628dd44185d33ed853d9b5d189c64713737a84679e4c718905cc3e1b1a) |
| oracle update | [0x83232c7a…9a1974](https://explorer.testnet.arc.io/tx/0x83232c7af832e56ed0ed026a0f1c9f7fc026213b43a069b71e5ddd3b7d9a1974) |
| vault executeTrade (proposal 0, 0 bps tETH) | [0x9801a0ff…add9ca](https://explorer.testnet.arc.io/tx/0x9801a0ffe2152a5578be19db1b93d902db848ef334982b6b4eec8aa2a2add9ca) |
| oracle update | [0x44db5a63…250409](https://explorer.testnet.arc.io/tx/0x44db5a639a11494eb8086fdaad8d547240312bbc1d5203aa7f41bf025b250409) |
| reportReturn (settle) | [0xe47c37ed…145951](https://explorer.testnet.arc.io/tx/0xe47c37edf5f7528acac9ed02b39efa08e123348f96eebebedcd27f9ac2145951) |

Phase B deployment, wiring and funding hashes are in `SOURCES.md` under "Phase B deployment".


## Phase B smoke rounds (new contracts, not yet current)

Contracts: QuantumRound `0x74b7…B0c5`, WaveV4ProposalMarket `0x5A2D…fa7A`, WavefundVault `0xA1E3…9865`, WaveHook `0xA2FD…8Ac0`.

### Round 1: cancelled by the vault slippage guard (pool was 3.6% off and ~0.44 USDC deep)

Collapse picked proposal 1 (20% tETH); seed after collapse 15.000000 and winning seed held 5.000000. `WavefundVault.executeTrade` then breached its 500 bps guard (actual out ≈ 13× below expected) and cancelled the round, which credited the winning seed back (reserve 20.000000). Both wallets redeemed their 6 USDC at par:
- Deployer redeem [`0xdc8f…0ada`](https://explorer.testnet.arc.io/tx/0xdc8fe0b9ffbe80ff7614f7c70c7770ce7cb069ecae4d1cdc2f12216de4960ada): +5.998495 USDC net of gas
- Keeper redeem [`0x6e80…8e4d`](https://explorer.testnet.arc.io/tx/0x6e80fa22f121af9dff0335fc332a1b0961bea3e0e4617d97a5c54906aa68ae4d): +5.998669 USDC net of gas
Other round-1 hashes: `contracts/deployments/phase-b-smoke-round1.json`.

The fix was a concentrated USDC/tETH position (see `SOURCES.md`, "USDC/tETH vault pool").

### Round 2: full normal path (deployer D, keeper K)

Window 480 s, TWAP 60 s, horizon 60 s, rMin 0.95 / rMax 1.05. Proposals: P1 20% tETH (D), P2 50% tETH (K), P3 80% tETH (D). Both wallets deposited 6 USDC, claimed 3 + 3 credits, bought and sold LONG and SHORT (half of each balance sold). pLong before collapse: P0 0.500000, P1 0.434436, **P2 0.618025**, P3 0.434436. Proposal 2 (not the status quo) won; the vault swapped 2.5 USDC into 0.001048 tETH (about 1.5% below the oracle rate, inside the 5% guard) and settled with realised return 0.992079 (−0.79%, swap costs).

| Step | Transaction |
|---|---|
| D approves USDC to 0x181E2A… | [0x9f68184f…c56e](https://explorer.testnet.arc.io/tx/0x9f68184f93cee26a0d15c201254d5f5e0989418d4d6bdb46a438dab17480c56e) |
| K approves USDC to 0x181E2A… | [0xe40eb672…6906](https://explorer.testnet.arc.io/tx/0xe40eb672034f7733b8535433ddbad821f36393b3fe3e5775941935874c966906) |
| D approves USDC to 0x74b798… | [0x6a34f85f…8094](https://explorer.testnet.arc.io/tx/0x6a34f85fec8052a130cbb49304b2670e87cfbb4c2c2a654cbd213f2a8d7e8094) |
| K approves USDC to 0x74b798… | [0xa6cbdc60…b6e1](https://explorer.testnet.arc.io/tx/0xa6cbdc6022de408cc65c3119d21ec88610a7c11eb20a1f65ec2868f91fe3b6e1) |
| Open Phase B smoke round | [0x0c234b32…cc2a](https://explorer.testnet.arc.io/tx/0x0c234b32b6c9d8a502f65347c283c09021d0abde335fca95a9d7df32108ccc2a) |
| D proposes 20% tETH | [0x6ed70a4e…b9f6](https://explorer.testnet.arc.io/tx/0x6ed70a4ea43e9745be1b3493480a33df8104391e385e3d1072b0fdffe256b9f6) |
| K proposes 50% tETH | [0x0622a22f…7081](https://explorer.testnet.arc.io/tx/0x0622a22fa0102afcbda1975bfc2b4e1be64e743ffcc1a1edbaa722823fbe7081) |
| D proposes 80% tETH | [0xa06cc258…6667](https://explorer.testnet.arc.io/tx/0xa06cc2583d175838202b651d68c7bd3132e6300302fa8d214374411b93ee6667) |
| D deposits 6 USDC | [0x95896346…5c70](https://explorer.testnet.arc.io/tx/0x958963468a337849fc92f14c5f7aba8897c97519afcc6347188645c02e175c70) |
| K deposits 6 USDC | [0x682660ab…c508](https://explorer.testnet.arc.io/tx/0x682660ab2f9cd5b512e51b4b2b3d8c152690929ddb2ca1ca0fb1ab148683c508) |
| D claims 3 credits on proposal 2 | [0x10e66df2…f0e6](https://explorer.testnet.arc.io/tx/0x10e66df285f6980c023a7bce8b7618aec90a2ad152e964745d978f0e3d4ef0e6) |
| D claims 3 credits on proposal 1 | [0xd2a4ebce…a938](https://explorer.testnet.arc.io/tx/0xd2a4ebce552621aa920b8b17465f4f17f015e3e7cbb1f93ec5c084d9611ba938) |
| K claims 3 credits on proposal 2 | [0x35c974a3…48c7](https://explorer.testnet.arc.io/tx/0x35c974a3902892b0c1a8e0a2950cf818cef8f78a9fad872f142654c5b0a448c7) |
| K claims 3 credits on proposal 3 | [0x65fe73e4…32ed](https://explorer.testnet.arc.io/tx/0x65fe73e4c9c165b5f812aad1e0f6fc212d0b0a2bb75c7a97cadc7d909ba932ed) |
| D buys LONG on proposal 2 with 2 credits (quote 3.425508) | [0x73499af7…5ec1](https://explorer.testnet.arc.io/tx/0x73499af7cc14b02b427cc765c460715770b763b3ec662b45991f7bbf5bc35ec1) |
| D buys SHORT on proposal 1 with 1.5 credits (quote 2.651182) | [0x80b935b2…8f4c](https://explorer.testnet.arc.io/tx/0x80b935b23459e7d157999e1409ddcfea58d9c1fe4a77d7a575fde0f7ba258f4c) |
| K buys LONG on proposal 2 with 1 credits (quote 1.445973) | [0x45dec9e8…314c](https://explorer.testnet.arc.io/tx/0x45dec9e805699fc1757df0ad963490a3c34514d3437be49ee3eaf945434a314c) |
| K buys SHORT on proposal 3 with 1.5 credits (quote 2.651182) | [0x3c1a8cdc…cd35](https://explorer.testnet.arc.io/tx/0x3c1a8cdc0ab2517fcc3482dd8ad967a2dda5dd13a7666273fb654f086c7acd35) |
| D sells 1.712754 LONG on proposal 2 (quote 1.172928 credits) | [0x60eb9a35…b9d0](https://explorer.testnet.arc.io/tx/0x60eb9a354575f55ad3c5a217593e3c23f5ee22c382b6032a7c63a172ca9bb9d0) |
| D sells 1.325591 SHORT on proposal 1 (quote 0.790603 credits) | [0x1790d282…74d4](https://explorer.testnet.arc.io/tx/0x1790d2822dd6f7c950c414f951751b4fa379d97566a4dbffd67c8e54a8e174d4) |
| K sells 0.722986 LONG on proposal 2 (quote 0.458089 credits) | [0x8d11be24…755c](https://explorer.testnet.arc.io/tx/0x8d11be2417447bba386222ccabc902206c5c2cfd9fd90b17c8e926b4ed1d755c) |
| K sells 1.325591 SHORT on proposal 3 (quote 0.790603 credits) | [0x08874e89…96c5](https://explorer.testnet.arc.io/tx/0x08874e8978f41e7bd6280c428491775fa41ae6c57e578f88e0f693a2221596c5) |
| Collapse round 2 | [0x42a58d75…2784](https://explorer.testnet.arc.io/tx/0x42a58d75cd5ab3c7b9d6d91295950b8666dfab2e74225e03568498568b1b2784) |
| Oracle update (pre-trade) | [0xf00b5f3f…d4b0](https://explorer.testnet.arc.io/tx/0xf00b5f3fba8d6b5f4d7449f121bf96013d30ebf3af4d2f6ab1373aa1b25ed4b0) |
| WavefundVault executes proposal 2 (5000 bps tETH) | [0xcd379541…89a2](https://explorer.testnet.arc.io/tx/0xcd3795412fea663183cf4f31bd4bd548beec523b36b2afa91f0fa23a240189a2) |
| Oracle update (settlement) | [0x7a1f9f1f…0bc1](https://explorer.testnet.arc.io/tx/0x7a1f9f1f07b638982fff0e398caf28e8ce03007e93ef10481132236b87b30bc1) |
| WavefundVault reports NAV and settles round 2 | [0x1bc8623c…5418](https://explorer.testnet.arc.io/tx/0x1bc8623c9f101f4385cf608491b08fbb47840cf7373417dddf5ecc86f8545418) |
| D redeems | [0xe12e72fb…13c6](https://explorer.testnet.arc.io/tx/0xe12e72fbc84f39ef007a01833881c94cc21bffd1702ab05896646842e35513c6) |
| K redeems | [0xdfcfbc99…b194](https://explorer.testnet.arc.io/tx/0xdfcfbc99d6650d2482277603228497eb20bb28f556570cc19d11c98f1a17b194) |

Report (all values USDC):

| | Before open | After proposals | After collapse | After settle | After both redemptions |
|---|---|---|---|---|---|
| `protocolLiquiditySeed` | 20.000000 | 0.000000 | 15.000000 | 15.000000 | **21.762833** |

- Losing markets' seed (3 × 5) returned at collapse (0 → 15). The winning market's 5 returned through settlement: on the last redemption the remaining collateral (5 winning seed + 12 deposits − 10.237167 payouts = 6.762833) moved back into the reserve (15 → 21.762833).
- Reconciliation (from USDC `Transfer` logs of the round contract): in = 12.000000 (two deposits); out = 10.237167 (D 5.184247 + K 5.052920). Reserve 20.000000 + 12.000000 − 10.237167 = **21.762833 = actual round balance and seed reserve. Unaccounted dust: 0.000000.**
- Bonds: all refunded at collapse (registry bonds D 0, K 0).
- The 1.762833 USDC the two wallets gave up stayed in the reserve: 0.30% fees and price impact on eight trades plus their unsold half-positions, which are worth less than par after settlement.
- Wallet USDC (before → after): D 23.092392 → 22.154264 (gas 0.122374), K 34.377408 → 33.275356 (gas 0.154972). Payout per wallet net of its own redeem gas: D 5.178274, K 5.047030 (gross 5.184247 / 5.052920).
- Vault: 5.000000 USDC / 0 tETH → 2.500000 USDC / 0.001048 tETH.

## Live test round 3 (frontend cutover)

- Pool recentred to ±20% (spot $2312.49, active liquidity 4,167,159,443,938): add position https://explorer.testnet.arc.io/tx/0x79b9a1cc5248b44b1df6324b495ddab982c75e993b0ca2e79245fde56cd20d87
- Open round 3 (20 min, ends 2026-10-26T19:14:59Z): https://explorer.testnet.arc.io/tx/0x9ed41d081e9ebbffa9251b75c4fa42b5c7b23bfe47012ec99a76adcc66c038c0
- Proposals: 20% https://explorer.testnet.arc.io/tx/0xb42dcc4107853de2246ff83ee27c23e28b486d6b9db72dc745a60c89eeccb165, 50% https://explorer.testnet.arc.io/tx/0xe017a82fccdb9cb4d7a1b28c46d8db824c07d91e2c7ea6fcf4fdd2f19fe6e3fe, 80% https://explorer.testnet.arc.io/tx/0x537692e255a6a1b5200e458d805054e587e31a2c32d3cdb34d67bc5e4f98a479
- Close with `npm run demo:close-round -- --execute` after testing; hashes to be added.

## Round 3 close and live test round 4

- Round 3 had no trades, so the status quo won. Collapse [`0x324c…c964`](https://explorer.testnet.arc.io/tx/0x324ca77650b56a5b3aa389974d37cc1d6b0fda0e18ce63b955fff87ee002c964), vault trade [`0x4b45…96a8`](https://explorer.testnet.arc.io/tx/0x4b45ad67bd9d0c1e947e75fc583069506aa44693a1e554b144c452f8ef0196a8), settle [`0xf27b…0c3b`](https://explorer.testnet.arc.io/tx/0xf27b0567127b6d78ba7a877c7c6d10ce4be0a462779212e423216d0e9f600c3b) (return ratio 0.993986). Its winning-market seed (5 USDC) returns to `protocolLiquiditySeed` once its liabilities are redeemed.
- Pool recentred: remove [`0xe2f4…6c83`](https://explorer.testnet.arc.io/tx/0xe2f4eb6fb6c93eddeb8ce138e0f089c1838063539338faecdb43baf06e76c83f), align [`0xaa73…54a5`](https://explorer.testnet.arc.io/tx/0xaa73aea0ea21901977e0275be3a1ddf0175c5dfbf4ead71f6a81f247084754a5), add [`0x4eb5…a32b`](https://explorer.testnet.arc.io/tx/0x4eb586b5e817251891bfd9a165ede96432444f7539da687590e04b4265a3a32b).
- Round 4 (30 min, trading ends 2026-10-26T20:03:39Z = 01:33:39 IST on 27 Oct): seed top-up [`0x9496…31b4`](https://explorer.testnet.arc.io/tx/0x9496864a6773862419a2ea5057c1e86e1ae40ca8e0567c6eeff9eb78731531b4), open [`0xac21…aa49`](https://explorer.testnet.arc.io/tx/0xac219556ddd4bd372781aa1a6dd8a9ac5de2ebbfd89582b3dafca0254eaeaa49), proposals [`0xee65…22bd`](https://explorer.testnet.arc.io/tx/0xee656de0632e72bf5f61209b41b7912971abdec3a13c1e66250cfb073a0f22bd) (20%), [`0x52a6…b983`](https://explorer.testnet.arc.io/tx/0x52a6a2f418abb1bd1622f07a44e91a778db2cba75ffe1d9319171c94d230b983) (50%), [`0x5c55…30a3`](https://explorer.testnet.arc.io/tx/0x5c553d3391cc9a38be9d78e441d8dc3af64e90db71286ea37c00e612a65630a3) (80%).

## Vault migration (old Phase B contracts, before the v2 redeploy)

Goal: let every WAVE holder exit and recover the protocol reserve before replacing the contracts.

| Step | Transaction |
| --- | --- |
| Round 5 open | [0x57b9…e0db](https://explorer.testnet.arc.io/tx/0x57b9eac63379da3dfc5129a6fd0647a0504719f056ce4ef9bfde02c48f41e0db) |
| Keeper deposit 0.1 USDC | [0xea2c…b26a](https://explorer.testnet.arc.io/tx/0xea2c797490eb499abe223308252b153a142ffe0ed062670a1a46af3b24a5b26a) |
| Keeper withdraw request | [0x84c0…da25](https://explorer.testnet.arc.io/tx/0x84c06b1b19f5259cb9f9332125706eace04ae5c6b0c0a5edf8a48274ffe6da25) |
| Deployer withdraw request | [0xbb6d…394d](https://explorer.testnet.arc.io/tx/0xbb6d6eec7e00a32a8332db4acea9eb333afe3fc9363d4607132c2e8ba50e394d) |
| Round 5 collapse | [0x8482…e5328](https://explorer.testnet.arc.io/tx/0x8482f14fb607c582b05c8cb624bc7433d068a850ce0ae07a639276a328ae5709) |
| Round 5 executeTrade (status quo) | [0xa693…bc0d](https://explorer.testnet.arc.io/tx/0xa693cb6c0a49d498f270296d07a853b4a743ff05f24c507187ab476ebc00bc0d) |
| Round 5 reportReturn | [0x0650…47fe](https://explorer.testnet.arc.io/tx/0x06507ce7bfb62c75448e368798eca57cc94c10fb5c70ebbec8ff330ea2d747fe) |
| Round 5 keeper redeem | [0x176c…261e1b](https://explorer.testnet.arc.io/tx/0x176c6fd7b24ead61f3e700721373cd5910912e421d03716fbc59ca17ba261e1b) |
| Round 6 open | [0x3ea9…85db](https://explorer.testnet.arc.io/tx/0x3ea9d4c58a34e740177e3bc2fdfd1a3e3ce2cc8b9ed63b74492493a285db855a) |
| Round 6 collapse | [0x61cf…870df](https://explorer.testnet.arc.io/tx/0x61cf260fe23914006db50a944349ff1bf8c9217643a7f2045d545931ccb870df) |
| Round 6 executeTrade | [0xc2f8…e78a](https://explorer.testnet.arc.io/tx/0xc2f836905afbe1ec9568a1d0343e5971979669b85e853c2de2366ae724e5e78a) |
| Round 6 reportReturn | [0x22af…76be4](https://explorer.testnet.arc.io/tx/0x22af2982f63111f0f25199ddde209bd2f46ebc9575dfaa5419e58db55d760be4) |
| Round 6 keeper redeem | [0x0334…1d2c](https://explorer.testnet.arc.io/tx/0x0334a2ac06fc6578536d818c5e565a43797a0dcc918708ab422bb4c54f5a1d2c) |
| Rescue 20.205275 USDC reserve to deployer | [0x4f34…ab69](https://explorer.testnet.arc.io/tx/0x4f34cedf3a008a983b241264d5b77f222276df634f41b4659f5777968cc5ab69) |

Outcome: WAVE supply is 1 wei (deployer dust, unredeemable), the old vault holds about 0.000001 USDC, and the reserve was back at 20.205275 USDC before the rescue.
Round 3's 5 USDC seed stays locked in the old `QuantumRound` (no release path existed there); it is not recoverable.


---

## Phase B v2 smoke rounds

Run on the v2 contracts with `keeper:run` handling collapse, the vault trade and settlement (raw logs: `smoke-v2-a.json`, `smoke-v2-b.json`).

### Round 1 (A): full path, non-status-quo winner

Three proposals (20%, 50%, 80% tETH). Wallet D deposited 1 USDC and claimed 1 credit in all four proposals (a second claim reverted: the per-proposal cap holds). It bought and sold LONG and SHORT across proposals; proposal 2 won and the vault traded 50% into tETH. Realised return 0.9938.

| Step | Transaction |
|---|---|
| D approves USDC to 0x181E2A | [0xf0d7…36f1](https://explorer.testnet.arc.io/tx/0xf0d759d042201ccc4f6adb426c0025b96c763aef4ff175d939094442ed2136f1) |
| K approves USDC to 0x181E2A | [0xd3a7…8bca](https://explorer.testnet.arc.io/tx/0xd3a7ea41a36eb776fc0417740b75cc596dc7190fd6df60fed1c7d6406da88bca) |
| D approves USDC to 0xc60ce4 | [0xc161…3280](https://explorer.testnet.arc.io/tx/0xc161e75b3cd9bed155ae8be2f3e7ce7dc38bb22781fee5a91b872e7410203280) |
| Open round | [0x21af…09d2](https://explorer.testnet.arc.io/tx/0x21af49dd02e76c9be3d9e7689e14ca3bb4bc7b9788395127c9110375233309d2) |
| D proposes 20% tETH | [0x68be…a6ba](https://explorer.testnet.arc.io/tx/0x68bed3baffdbe50faa40922cc30e6814e5ee847b50724012eda99347c709a6ba) |
| K proposes 50% tETH | [0x3475…8ef4](https://explorer.testnet.arc.io/tx/0x3475a29007900dace06fe563a6d297d421426c96ce0661182f2ff6b8bfe48ef4) |
| D proposes 80% tETH | [0xcf9a…1bb1](https://explorer.testnet.arc.io/tx/0xcf9afe0b56757472b99a742bc3f574336d3b1020c36bb0501e01b9efa4921bb1) |
| D deposits 1 USDC | [0xf597…276b](https://explorer.testnet.arc.io/tx/0xf5975468cc89ad3734cebf78e8c440bfc1b3e930cfcfd33ee6e2ba16b316276b) |
| D claims 1 credit on proposal 0 | [0xf6fe…5da7](https://explorer.testnet.arc.io/tx/0xf6fee8e5f7bb78f4caf16386a3016959ffe5e3a2d4df02ce1a18ab9381435da7) |
| D claims 1 credit on proposal 1 | [0xb45b…f77b](https://explorer.testnet.arc.io/tx/0xb45bcfa3fd90f3ffe2204dbea0d70f2d2d647a664642091177d0d5325e9bf77b) |
| D claims 1 credit on proposal 2 | [0x37f9…b5f8](https://explorer.testnet.arc.io/tx/0x37f95f3a77884f330eac22e5266739c2fe8ece30a8b7014d423227ac8e33b5f8) |
| D claims 1 credit on proposal 3 | [0x55d2…d100](https://explorer.testnet.arc.io/tx/0x55d2ae2832aedf29878d00cb94ce2d672ff5f2165681c6511b1aa33a8248d100) |
| D buys LONG on proposal 2 with 1 credits (quote 1.831249) | [0xb5cd…a366](https://explorer.testnet.arc.io/tx/0xb5cd91797e7750a6dcb540bf3166acb3ed6afba1dcfa69718fdd139c4208a366) |
| D buys SHORT on proposal 1 with 1 credits (quote 1.831249) | [0xe713…f278](https://explorer.testnet.arc.io/tx/0xe71350607e028aa8f47878f4d9c6fe944450b74cc84b9c5329abdbdb2b7ef278) |
| D buys SHORT on proposal 3 with 1 credits (quote 1.831249) | [0x1d02…939d](https://explorer.testnet.arc.io/tx/0x1d02f39e6f775feb7c6ae5c1e08cd1ddc6b9e5bc4f1b0706402f25bda0e3939d) |
| D sells 0.915624 LONG on proposal 2 (quote 0.519260 credits) | [0x32dd…30fb](https://explorer.testnet.arc.io/tx/0x32dd5a9c6cc62a9544eb8cc2b53104070b8c876c72400101c831c9a4af2a30fb) |
| D sells 0.915624 SHORT on proposal 1 (quote 0.519260 credits) | [0xe0ee…bc91](https://explorer.testnet.arc.io/tx/0xe0ee23a6a23a2a5d05ee14eaca69188fdd004475b19a501bce23bcd1f5c4bc91) |
| D sells 0.915624 SHORT on proposal 3 (quote 0.519260 credits) | [0x6bf5…ff67](https://explorer.testnet.arc.io/tx/0x6bf51d3c97e6f863783522d340c8b9e83ddffef13137d13717d37ac86351ff67) |
| D redeems | [0x4492…af28](https://explorer.testnet.arc.io/tx/0x44920698b788978767390823db8681e8c3c69e2e6b1bd45ffbbf28c2f71baf28) |

Redeem check: expected `deposit − claimed[winner] + credits + LONG×π + SHORT×(1−π)` = 0.920087 USDC; actual = 0.920087 USDC (match: True). Positions in erased proposals did not reduce it.

| USDC (6 dp) | Before | After redeem |
|---|---|---|
| Reserve (`protocolLiquiditySeed`) | 20.000000 | 20.079913 |
| QuantumRound balance | 20.000000 | 20.079913 |
| Vault USDC | 5.000000 | 2.500000 (+0.001055 tETH) |
| Wallet D | 41.813916 | 41.564568 (net of gas) |

Reconciliation: 1.000000 in = 0.920087 paid out + 0.079913 kept by the reserve (reserve 20.000000 → 20.079913; round balance equals reserve). Unaccounted: 0. The vault moved 2.5 USDC into tETH as the winning trade.

### Round 2 (B): empty round

Nobody deposited. Status quo won, the vault did not trade (vault balances unchanged), and the seed returned to the reserve at settle without any redeem (reserve 20.079913 before and 20.079913 after).

| Step | Transaction |
|---|---|
| Open round | [0xfdd5…2da3](https://explorer.testnet.arc.io/tx/0xfdd5a56939d67ba27ff35c5169d13e8fc63e75b97bafe9bce22ac2d53cbf2da3) |

Reconciliation: USDC in 0, USDC out 0, reserve unchanged, unaccounted 0.

## Round 3 cleanup

Status: Settled; status quo won and no vault principal trade was required.

The four proposal seeds returned to the protocol reserve. Three 1 USDC proposer bonds were refunded (2 USDC to the deployer proposer and 1 USDC to the keeper proposer). There were no forecaster liabilities. The realised-return ratio was `999946812775732442`.

| Action | Transaction | Result |
|---|---|---|
| Collapse round 3 | [0xcbb7c53da962a7005851be8ed334b5fccb0c6ba606c7e6ec8125c08195af63af](https://explorer.testnet.arc.io/tx/0xcbb7c53da962a7005851be8ed334b5fccb0c6ba606c7e6ec8125c08195af63af) | Confirmed |
| Keeper oracle price update | [0x14e8b050c19fc735ca3ef4607ba9599cf5d6f1f57b39f40e0fa77bf14beed2c7](https://explorer.testnet.arc.io/tx/0x14e8b050c19fc735ca3ef4607ba9599cf5d6f1f57b39f40e0fa77bf14beed2c7) | Confirmed |
| Status-quo vault execution (no principal swap) | [0x2cd062cefb13a34f7319de6fe787deeec84da57f1533746c2c9ed0dd17f32c41](https://explorer.testnet.arc.io/tx/0x2cd062cefb13a34f7319de6fe787deeec84da57f1533746c2c9ed0dd17f32c41) | Confirmed |
| Keeper oracle price update | [0xaf7fff3b331873b98d1f8688ba5fbcd7c6aec2b4960f69e1adb162bc33abf006](https://explorer.testnet.arc.io/tx/0xaf7fff3b331873b98d1f8688ba5fbcd7c6aec2b4960f69e1adb162bc33abf006) | Confirmed |
| Report return and settle round 3 | [0x9bc0fedfe887350d93e615040519a0ef90f71676dde412672ddf0dc5ae2524c0](https://explorer.testnet.arc.io/tx/0x9bc0fedfe887350d93e615040519a0ef90f71676dde412672ddf0dc5ae2524c0) | Confirmed |

Reconciliation: protocol seed increased from 0.079913 to 20.079913 USDC (+20 USDC returned from the four proposal seeds). The status-quo vault execution did not swap principal. Keeper gas used was 0.029199219 USDC, below the approved 0.10 USDC ceiling. No forecaster claims or redemptions were outstanding.

## Agent wallet funding

Date: 2026-10-30. Network: Arc Testnet (chain ID 5042002). Source: Wavefund Deployer `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`. Each approved ERC-20 USDC transfer was 1.25 USDC: 1.00 USDC principal (proposer bond or forecaster deposit) plus 0.25 USDC reserved for Arc gas. Total sent: 6.25 USDC. All five receipts succeeded, and each wallet's on-chain ERC-20 USDC balance was verified at 1.25 USDC immediately after its transfer.

| Agent | Role | Address | Amount | Transaction | Verified balance |
|---|---|---|---:|---|---:|
| Momentum | Proposer | `0x927751387951b69390151f34f3dd756a624abc0d` | 1.25 USDC | [0x383e24378a8f5fd66073cc928ef211620c38ebd50a4ec322f0122e7c17095298](https://explorer.testnet.arc.io/tx/0x383e24378a8f5fd66073cc928ef211620c38ebd50a4ec322f0122e7c17095298) | 1.25 USDC |
| Mean-reversion | Proposer | `0x2901ab7721217a1733b744009847dfe3d9f70e25` | 1.25 USDC | [0xf900033cbaa8355df0f0e57c0cb9fe0a59ba562ae1907a86ce1c08228b16c37a](https://explorer.testnet.arc.io/tx/0xf900033cbaa8355df0f0e57c0cb9fe0a59ba562ae1907a86ce1c08228b16c37a) | 1.25 USDC |
| News | Proposer | `0x324ec3c47f7c28c254977a14ca0ecec05524c455` | 1.25 USDC | [0x5a2b912a17f9a9c4feadefb705d0d71182cbca7c911b6d22c2efe91d6e01fc96](https://explorer.testnet.arc.io/tx/0x5a2b912a17f9a9c4feadefb705d0d71182cbca7c911b6d22c2efe91d6e01fc96) | 1.25 USDC |
| Quant | Forecaster | `0x66617018c7d91e1345ea9f51b44a062aad2d439e` | 1.25 USDC | [0xd56b7c3f313e298113398de92a31c631ea5366fc2978f6f97f1e493c7e356d5d](https://explorer.testnet.arc.io/tx/0xd56b7c3f313e298113398de92a31c631ea5366fc2978f6f97f1e493c7e356d5d) | 1.25 USDC |
| Guardian | Forecaster | `0x4a1ba43da2b795d68f63f34fba185d92a08f1d5f` | 1.25 USDC | [0x2f1c6d4d9d87d3d4bf9aecbce61b5b10fb8a4006ea1ff8d8b1231da56880f6ee](https://explorer.testnet.arc.io/tx/0x2f1c6d4d9d87d3d4bf9aecbce61b5b10fb8a4006ea1ff8d8b1231da56880f6ee) | 1.25 USDC |

Funding reconciliation: 5 × 1.25 USDC = 6.25 USDC transferred; recipient ERC-20 balances total 6.25 USDC. The native gas and ERC-20 USDC balance views are not added together.

## Pool recenter before round 4

The original position was outside the oracle-alignment tolerance: pool spot was $2,349.24 versus a $2,236.30 Coinbase quote (5.05% deviation). Its range was $2,104.89–$2,824.27 (ticks 196860–199800); removal returned approximately 10.683967 USDC and 0.007486886353817853 tETH.

| Action | Transaction | Result |
|---|---|---|
| Remove old managed position | [0x5d6d48b4934ac092c0b46958a9fe58f8491a6e2a670a3d822c9a4be3dd000956](https://explorer.testnet.arc.io/tx/0x5d6d48b4934ac092c0b46958a9fe58f8491a6e2a670a3d822c9a4be3dd000956) | Confirmed |
| Align pool to oracle | [0xd5db075aada5d73e6a068e71aecca0a88897d0db393595f6c15575ffcb2dd3ea](https://explorer.testnet.arc.io/tx/0xd5db075aada5d73e6a068e71aecca0a88897d0db393595f6c15575ffcb2dd3ea) | Confirmed |
| Add recentered position | [0x1d867ee0139f73ca29dc29a9045d6ce7a19239732f3328c76bcacf0b44b9add2](https://explorer.testnet.arc.io/tx/0x1d867ee0139f73ca29dc29a9045d6ce7a19239732f3328c76bcacf0b44b9add2) | Confirmed |

The new position uses ticks 197340–200280 ($2,006.25–$2,691.91). Its verified inventory is approximately 10.553430 USDC and 0.007909724853585232 tETH. At add time the pool was $2,236.30 versus a $2,240.66 oracle quote (0.20% deviation). No new USDC principal beyond the recovered position was used; gas was paid separately. The recenter script now enforces a configurable new-USDC cap and persists recovered assets across an interrupted run. Its TickMath constant was corrected after a read-only add simulation caught the error; no failed liquidity-add transaction was sent.

## Round 4

Status: Settled; status quo won, with one on-chain proposal and no deposits.

| Action | Transaction | Result |
|---|---|---|
| Open status-quo-only round (20-minute trading, 600-second evaluation) | [0x5d566bc463f9e40d1a1d398d8c32c7d766bb4610388716608e14c1bac10c2c73](https://explorer.testnet.arc.io/tx/0x5d566bc463f9e40d1a1d398d8c32c7d766bb4610388716608e14c1bac10c2c73) | Confirmed |
| Collapse round 4 | [0xecd341a1bedead0bfae785d802a9c849c191577bac7e648dcc6f1288bebf6f9e](https://explorer.testnet.arc.io/tx/0xecd341a1bedead0bfae785d802a9c849c191577bac7e648dcc6f1288bebf6f9e) | Confirmed |
| Status-quo vault execution (no principal swap) | [0xe5526bb8bc283b92d59e5faf5ed6272d86e56cee3b2c150384a626efad37df9a](https://explorer.testnet.arc.io/tx/0xe5526bb8bc283b92d59e5faf5ed6272d86e56cee3b2c150384a626efad37df9a) | Confirmed |
| Report return and settle round 4 | [0x61bfdc58b4547e613a0c6bef41d9b4081320bf6981db6063bcc0854a9cee0460](https://explorer.testnet.arc.io/tx/0x61bfdc58b4547e613a0c6bef41d9b4081320bf6981db6063bcc0854a9cee0460) | Confirmed |

The protocol seed was 20.079913 USDC before opening, 15.079913 USDC while the 5 USDC status-quo market was active, and 20.079913 USDC after settlement. Vault inventory was unchanged: 2.5 USDC and 0.001054719528886627 tETH before and after. All five agent wallets still held 1.25 USDC.

The proposer dry-run ran during the open window only. Momentum recommended 4100 bps (not a duplicate); Mean-reversion recommended 4900 bps (suppressed within 500 bps of status quo); News recommended 4100 bps (suppressed as a duplicate of Momentum). All decisions were logged as `dryRun: true` and `submitted: false`; no live agent proposal was sent.
