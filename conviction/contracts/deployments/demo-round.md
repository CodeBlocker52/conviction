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
