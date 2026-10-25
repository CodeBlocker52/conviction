# Wavefund Phase A — Arc Testnet Deployment and Sources

## Network and operating rules

- Chain: Arc Testnet, chain ID `5042002`
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://explorer.testnet.arc.io`
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals)
- Native gas asset: USDC-denominated, 18 decimals. Do not combine its balance with ERC-20 USDC.
- Arc's blocklist precompile makes Foundry simulation unreliable for USDC transfers. Use the project's viem scripts against the real RPC for token-moving actions; use Forge for build, tests, and deployments that do not move USDC.
- Source configuration: Solidity `0.8.26`, Osaka EVM, `via_ir = true`; Uniswap v4 core `1.0.2`.
- `current.json` is the canonical application and demo-script address config. `npm run check:contracts` rebuilds Forge artifacts and checks configured Arc addresses, the checked-in app ABI selectors, and this deployment record. Keep the app ABIs aligned with the active deployment; regenerate them with `node contracts/script/generate-contract-abis.mjs` only when updating the frontend to a deployment that includes the corresponding contracts.

## Current deployment

Admin/deployer: `0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2`
Keeper: `0xE7DD9a5fafa5739B466C61914311e39717f7192c`

| Contract | Address | Deployment transaction |
|---|---|---|
| TestAsset (tETH, reused) | `0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d` | Existing |
| ProposalTokens (reused) | `0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51` | Existing |
| ProposerRegistry (reused) | `0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346` | Existing |
| ConstantProductMarket | `0xEC6d767c62029A2868E1475873D9C2aE172F72df` | [0x906c0769418ed185f10012f9d238ac448dc0985ac1931e39f756bd6308945a8f](https://explorer.testnet.arc.io/tx/0x906c0769418ed185f10012f9d238ac448dc0985ac1931e39f756bd6308945a8f) |
| QuantumRound | `0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41` | [0x7ab243c3a3c6e201061ab4800e9cc011becb2342c66b4bf28efce3c15e8d9140](https://explorer.testnet.arc.io/tx/0x7ab243c3a3c6e201061ab4800e9cc011becb2342c66b4bf28efce3c15e8d9140) |
| Resolver | `0xeA89585fb62e6eB63D101409093D88A94A936A4C` | [0x11fc86d7d60158493a63d590431e16e8d0f7269b08cab4cc285edf5b7fd479d0](https://explorer.testnet.arc.io/tx/0x11fc86d7d60158493a63d590431e16e8d0f7269b08cab4cc285edf5b7fd479d0) |
| QuantumLP | `0x885512902D1f5d05f81A678FdFFE0e339623c415` | [0x4a0068639460d4e9935b477a58df5cc7b1ea1fb7a4f61060824a57647407aa1a](https://explorer.testnet.arc.io/tx/0x4a0068639460d4e9935b477a58df5cc7b1ea1fb7a4f61060824a57647407aa1a) |
| WavefundVault (queued WAVE shares) | `0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D` | [0x50f80e5ca41a06b46de2271e4c5a3b4d6fda707ff8eef65c87c4650ca940188d](https://explorer.testnet.arc.io/tx/0x50f80e5ca41a06b46de2271e4c5a3b4d6fda707ff8eef65c87c4650ca940188d) |
| MockPriceOracle | `0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d` | [0x93a397ec5c073310c1bbdaa5e877a25925afb57dc4d2b1e0bc4ad0e39db63cf3](https://explorer.testnet.arc.io/tx/0x93a397ec5c073310c1bbdaa5e877a25925afb57dc4d2b1e0bc4ad0e39db63cf3) |

The current addresses have code on Arc Testnet. The upgrade reused tETH, ProposalTokens, and ProposerRegistry after checking roles and state; the previous round had no rounds opened. Old QuantumRound protocol seed had no rescue path and remains locked.

### Source verification

The following current and reused Wavefund contracts have Sourcify full matches; Sourcify mirrored the verified sources to Arc's Blockscout explorer. These are source-verification links, not deployment transactions.

| Contract | Verification | Arc explorer |
|---|---|---|
| TestAsset (tETH, reused) | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d) |
| ProposalTokens (reused) | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51) |
| ProposerRegistry (reused) | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346) |
| ConstantProductMarket | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0xEC6d767c62029A2868E1475873D9C2aE172F72df) |
| QuantumRound | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41) |
| Resolver | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0xeA89585fb62e6eB63D101409093D88A94A936A4C) |
| QuantumLP | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0x885512902D1f5d05f81A678FdFFE0e339623c415) |
| WavefundVault (queued WAVE shares) | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D) |
| MockPriceOracle | Sourcify full match | [Contract](https://explorer.testnet.arc.io/address/0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d) |

The previous vault `0x65648366C96Af7b3c2ECdC1B78A06d975A1505F3` is superseded. Its 2 USDC balance cannot be withdrawn or migrated: the deployed bytecode has no admin withdrawal/rescue, token-approval, or arbitrary-call path, and it is not an upgradeable proxy. The current queued-share vault's import method can only import USDC the admin controls and approves.

The new vault was deployed from `contracts/script/DeployShareVault.s.sol`. The deployer granted the new vault `VAULT_ROLE` and revoked it from the legacy vault on QuantumRound; Resolver authorization was migrated the same way. QuantumRound and Resolver remain at their existing addresses.

| Role migration action | Transaction |
|---|---|
| Grant QuantumRound role to new vault | [0x89c0969bf6e073ac3014c7f5a94e9456221b75f7eba7fce6902ba803e3dc812c](https://explorer.testnet.arc.io/tx/0x89c0969bf6e073ac3014c7f5a94e9456221b75f7eba7fce6902ba803e3dc812c) |
| Revoke QuantumRound role from legacy vault | [0x7e815f202c95b90a90998f86787de60f3886da03cabd97d70b0438253510bd9c](https://explorer.testnet.arc.io/tx/0x7e815f202c95b90a90998f86787de60f3886da03cabd97d70b0438253510bd9c) |
| Grant Resolver role to new vault | [0xcbb0cacf66694bb90e5250df185ba0c5362c5398c99c970cbeda64e58c8d1258](https://explorer.testnet.arc.io/tx/0xcbb0cacf66694bb90e5250df185ba0c5362c5398c99c970cbeda64e58c8d1258) |
| Revoke Resolver role from legacy vault | [0xbc8c28d3d762adc838bdd7bd3fdfc6d656558a06d48326030945655c9c214a4a](https://explorer.testnet.arc.io/tx/0xbc8c28d3d762adc838bdd7bd3fdfc6d656558a06d48326030945655c9c214a4a) |
| Grant QuantumRound caller role to new vault | [0x704a5e54c240a56dc4b2f778ed0f83ee5a295beffb0aa3a61532284c163e7dc0](https://explorer.testnet.arc.io/tx/0x704a5e54c240a56dc4b2f778ed0f83ee5a295beffb0aa3a61532284c163e7dc0) |
| Grant keeper role to new vault | [0x5aeff189048ac56e4829cfed9acae76f57b0136138a9267cfcecc40c932ed12c](https://explorer.testnet.arc.io/tx/0x5aeff189048ac56e4829cfed9acae76f57b0136138a9267cfcecc40c932ed12c) |

### Superseded deployment

These addresses are historical and are not the current frontend configuration:

| Contract | Superseded address |
|---|---|
| ConstantProductMarket | `0xF01045EaFaC5CeC441d2619D588a4E82E6eeB28E` |
| QuantumRound | `0x7c601921721658D7f00f6Ec1d61DABbBA77A7118` |
| Resolver | `0x509ECfd14076149d402BD843CebE4df3e7889259` |
| WavefundVault | `0xBd736f0617A408bDA29F6F44eae6B768a1087298` |
| QuantumLP | `0x9CFF913Fbc88bC6572C1D0B5820Ea9dd40d11d06` |
| WavefundVault (pre-share; unrecoverable 2 USDC) | `0x65648366C96Af7b3c2ECdC1B78A06d975A1505F3` |

## External Arc testnet contracts

| Contract | Address | Source |
|---|---|---|
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` | Arc testnet / Peach RC2 deployment; verified via PositionManager |
| Uniswap v4 PositionManager | `0x87Dd714940ea540c921a92216e6E0DE1E2b1735C` | Arc testnet / Peach RC2 deployment |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Canonical Permit2 address; code verified on Arc testnet |

## Funding and oracle transactions

The new QuantumRound was funded with `25.118770 USDC`; its initial per-proposal liquidity is `2.511877 USDC` across 10 proposal slots. The vault was funded with `2 USDC`.

| Action | Transaction |
|---|---|
| Approve proposal seed | [0x73c14eea528fd8309f7df80d38b90ce836eb066070cb92c312e6cc97e81dde57](https://explorer.testnet.arc.io/tx/0x73c14eea528fd8309f7df80d38b90ce836eb066070cb92c312e6cc97e81dde57) |
| Fund proposal seed | [0x563390757701b5bc67eb77e9342f6229c0bcdd385c7056956cfcbec7ada302cd](https://explorer.testnet.arc.io/tx/0x563390757701b5bc67eb77e9342f6229c0bcdd385c7056956cfcbec7ada302cd) |
| Approve vault funding | [0xb7cf8bf8c19bc478bb879bcc0f79b923daf1911d714cc7d278962766c74e15ad](https://explorer.testnet.arc.io/tx/0xb7cf8bf8c19bc478bb879bcc0f79b923daf1911d714cc7d278962766c74e15ad) |
| Fund vault | [0xcfaecf855a6a6eab6583c972f43ee66f554f6153669ecf2397bbfa9a9a84bf94](https://explorer.testnet.arc.io/tx/0xcfaecf855a6a6eab6583c972f43ee66f554f6153669ecf2397bbfa9a9a84bf94) |
| Fund keeper native gas | [0xa505dd13120f68c2a3376da2f9e60e9a7ea12e0f45cf872219c249c1a0044966](https://explorer.testnet.arc.io/tx/0xa505dd13120f68c2a3376da2f9e60e9a7ea12e0f45cf872219c249c1a0044966) |
| Keeper oracle update | [0xb1a3566a4468912e6e258b0fe99fe47b6ee1bbb2c8a4f23a6a56147ea12b2b9d](https://explorer.testnet.arc.io/tx/0xb1a3566a4468912e6e258b0fe99fe47b6ee1bbb2c8a4f23a6a56147ea12b2b9d) |
| Keeper oracle update | [0x6b5f88bbbfa27c4210ea2c89712f5157ff49fbdd26f53c89c0591741cdd913a2](https://explorer.testnet.arc.io/tx/0x6b5f88bbbfa27c4210ea2c89712f5157ff49fbdd26f53c89c0591741cdd913a2) |
| Keeper oracle update | [0xa5f8c62935ea5fa024a3fd493367574105cb494c4104906f11ba96be81c6d235](https://explorer.testnet.arc.io/tx/0xa5f8c62935ea5fa024a3fd493367574105cb494c4104906f11ba96be81c6d235) |

## Uniswap v4 test pool

- Pool ID: `0xf97ceccf5459daf2698220187746a07ffe754c79519e0fec30b2b33d967df176`
- Key: USDC / deployed tETH, fee `3000`, tick spacing `60`, no hook.
- Initial price: `2,400.125 USDC per tETH`, based on the keeper oracle.
- Liquidity was added and a `0.05 USDC` swap was completed through an owner-restricted callback. A reverse tETH-to-USDC swap returned the pool close to oracle price; observed spot was `2,401.561830 USDC per tETH` against oracle `2,400.125`.
- Callback used: `0xFaDBe81aF357757d2cd84e33883fe41579f88c97`. The first callback (`0x86A7e11FFE11b4abd0929b2eEE18A3011610957B`) is obsolete. Token approvals to both callbacks have been reset to zero.

| Action | Transaction |
|---|---|
| Initialize pool | [0x522621d7b79ab08d9c956f6bd02b346a7bedb03bfcf84312354b92c372741de7](https://explorer.testnet.arc.io/tx/0x522621d7b79ab08d9c956f6bd02b346a7bedb03bfcf84312354b92c372741de7) |
| Deploy obsolete callback | [0xd3eaaa536d42ab3a916b845e4bb92c974217fddd4d085d547d42e2c80eb5c1a9](https://explorer.testnet.arc.io/tx/0xd3eaaa536d42ab3a916b845e4bb92c974217fddd4d085d547d42e2c80eb5c1a9) |
| Deploy corrected callback | [0xa20358b4e409285ba325d92d1ca5e603b9f5eebb4d74ee711d24183a404aa24a](https://explorer.testnet.arc.io/tx/0xa20358b4e409285ba325d92d1ca5e603b9f5eebb4d74ee711d24183a404aa24a) |
| Approve USDC for obsolete callback | [0x7f425553fc329ca2c20fedbf988ca7e32a582f886e16ace5b726014ff1e56cca](https://explorer.testnet.arc.io/tx/0x7f425553fc329ca2c20fedbf988ca7e32a582f886e16ace5b726014ff1e56cca) |
| Approve tETH for obsolete callback | [0x77158666717e7c0affcf3715e21edb0fba3228270119619261c049fc8b026528](https://explorer.testnet.arc.io/tx/0x77158666717e7c0affcf3715e21edb0fba3228270119619261c049fc8b026528) |
| Approve USDC for corrected callback | [0x45d8304ef43d5b6c1d926b994594bc73e310910b011fe3125913ef6db25565bd](https://explorer.testnet.arc.io/tx/0x45d8304ef43d5b6c1d926b994594bc73e310910b011fe3125913ef6db25565bd) |
| Approve tETH for corrected callback | [0x5430dadad0e5e8545a3d76089fe67d8df3f777767e3c5fe5cba8108fb6d51069](https://explorer.testnet.arc.io/tx/0x5430dadad0e5e8545a3d76089fe67d8df3f777767e3c5fe5cba8108fb6d51069) |
| Add liquidity | [0xa856d6d874fee5956451193c057d98c21deee7302ba1beb4bb5045f35b8fc212](https://explorer.testnet.arc.io/tx/0xa856d6d874fee5956451193c057d98c21deee7302ba1beb4bb5045f35b8fc212) |
| USDC-to-tETH smoke swap | [0xe3d77d295c64a97b549256bee0215445585391fddbbe1a9e71338234a1547811](https://explorer.testnet.arc.io/tx/0xe3d77d295c64a97b549256bee0215445585391fddbbe1a9e71338234a1547811) |
| Reverse swap and pool rebalance | [0x94558db3d261fec4e8c60ad4d754e47e17c4c0db534cbb0dddea094a2b2863ec](https://explorer.testnet.arc.io/tx/0x94558db3d261fec4e8c60ad4d754e47e17c4c0db534cbb0dddea094a2b2863ec) |
| Revoke obsolete USDC approval | [0x09df3d617af9cdc34d95ce26d69836b6a28e97a45c467cd43bd688a40586b013](https://explorer.testnet.arc.io/tx/0x09df3d617af9cdc34d95ce26d69836b6a28e97a45c467cd43bd688a40586b013) |
| Revoke corrected USDC approval | [0x92fe8f33127b9cc3eb0e053ad3ed9e1676063ea1a3c5a859c1db3c7657086e48](https://explorer.testnet.arc.io/tx/0x92fe8f33127b9cc3eb0e053ad3ed9e1676063ea1a3c5a859c1db3c7657086e48) |
| Revoke obsolete tETH approval | [0xd8d6970294e2890f12b21cdedb44c012f1af54a6cd9f261130cf5dd3d20075d8](https://explorer.testnet.arc.io/tx/0xd8d6970294e2890f12b21cdedb44c012f1af54a6cd9f261130cf5dd3d20075d8) |
| Revoke corrected tETH approval | [0x20c5faf8e112fc2edc0849deb4bb4d0cc8f582a5e2f5caa61f97d2b521da59c6](https://explorer.testnet.arc.io/tx/0x20c5faf8e112fc2edc0849deb4bb4d0cc8f582a5e2f5caa61f97d2b521da59c6) |

## Oracle source and current limitations

The deployed `MockPriceOracle` is keeper-fed using Coinbase's public ETH/USD quote, stored with 8 decimal places. The contract rejects stale values after five minutes. Run a one-shot update with `npm run oracle:update`; start or stop the managed watcher with `npm run oracle:start` / `npm run oracle:stop`. The watcher checks the latest round every 60 seconds and submits an update only while that round exists and is neither settled nor canceled, avoiding idle keeper transactions.

No fresh, verifiable decentralized ETH/USD feed on Arc Testnet was confirmed during deployment checks. Pyth's verified Arc deployment was mainnet-only; Stork had an Arc Testnet contract but no verified fresh ETH/USD feed ID/value; Chainlink and RedStone listings did not identify a verified Arc Testnet feed. The keeper-fed oracle is therefore a centralized testnet fallback, not a production oracle.

## Full-round demo status

The v4 smoke test and full on-chain demo are complete; all confirmed actions are linked in [`demo-round.md`](./demo-round.md). Attempt 1 selected a 50% tETH allocation, but its 0.05-USDC swap exceeded the vault's 5% slippage limit and canceled safely; both user deposits were redeemed at par. Attempt 2 selected a 7.5% tETH allocation and completed the real `WavefundVault`/Uniswap v4 swap, NAV report, settlement, and both redemptions. Round 2 is settled, not canceled, and reported a `0.99655` return ratio. Its final vault state is `0.0925 USDC` plus `0.000003062520335899 tETH`; all `0.1 WAVE` shares remain with the deployer.

The demo runner's planned principal is 3.6 USDC from the deployer (0.1-USDC initial vault bootstrap, two 1-USDC proposal bonds, and a 1.5-USDC round deposit) and 2.5 USDC from the keeper (one 1-USDC bond and a 1.5-USDC round deposit), plus Arc transaction fees. Fees are paid in USDC. Final balances after both attempts were 59.455213 USDC for the deployer and 39.687255 USDC for the keeper. The runner now permits a retry only when the preceding round is canceled and settled; it refunds any outstanding deposits, requires all vault shares to belong to the deployer, and checks the seed, roles, balances, and pool/oracle deviation before opening another round.

## Phase B compatibility test (throwaway)

This isolated Arc Testnet test exercised `WaveHook` against the deployed Uniswap v4 PoolManager. It is not part of `current.json`, the frontend configuration, the Phase A market, the vault, or Round 3. It used only test tokens for pool operations; no USDC token transfer or existing Wavefund contract was involved. Arc-native USDC paid the transaction fees listed below.

The hook at the address below is the throwaway single-pool compatibility deployment, not the new shared Phase B hook. No shared Phase B hook is deployed or configured in `current.json`; add its address only during an approved Phase B deployment/cutover.

| Component | Address |
|---|---|
| Uniswap v4 PoolManager | `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |
| Compatibility adapter | [`0xD9E2F10672Fc8e7871b401D7a24c82a78da71F78`](https://explorer.testnet.arc.io/address/0xD9E2F10672Fc8e7871b401D7a24c82a78da71F78) |
| Test LONG token (`tLONG`) | [`0xBae016c485053291E4759f2d43bC81e91581A30E`](https://explorer.testnet.arc.io/address/0xBae016c485053291E4759f2d43bC81e91581A30E) |
| Test SHORT token (`tSHORT`) | [`0x4feA188D57035F6A1CA0425bD7c65Bd21aC59Ad6`](https://explorer.testnet.arc.io/address/0x4feA188D57035F6A1CA0425bD7c65Bd21aC59Ad6) |
| `WaveHook` | [`0x41cef812b6FF61419284E56f4380D4890cD28ac0`](https://explorer.testnet.arc.io/address/0x41cef812b6FF61419284E56f4380D4890cD28ac0) |

The hook was mined with permission flags `2752` (`beforeAddLiquidity`, `beforeRemoveLiquidity`, `beforeSwap`, `afterSwap`) and verified on Sourcify with status `match`. [Sourcify verification job](https://sourcify.dev/server/verify-ui/jobs/5e791e6a-db78-4b5f-8dff-e46bcdb62ad9).

The test pool used fee `3000`, tick spacing `60`, and an initial price of `1:1`. The adapter minted `10` test tokens per side, added `1e18` liquidity across ticks `-45,900` to `45,900`, and executed one exact-input swap of `0.01` test tokens. `pLong` moved from `0.500000000000000000` to `0.504960150997815123`; `pShort` was `0.495039849002184877`, so the two remained complementary. The hook's trading window was Unix timestamps `1792884131`–`1792887731`.

The simulation estimated `0.1613021 USDC` at a `25 gwei` max fee, below the authorized `0.25 USDC` ceiling. The five successful transactions cost `0.100670493 USDC` in total at the actual `21 gwei` effective gas price:

| Action | Transaction | Contract or target |
|---|---|---|
| Deploy adapter and its two test tokens | [0xd245087faec87d4f4f0e9fbe3098f8d78aa568e731e7bfc7a260c29d2c6d84e3](https://explorer.testnet.arc.io/tx/0xd245087faec87d4f4f0e9fbe3098f8d78aa568e731e7bfc7a260c29d2c6d84e3) | Adapter `0xD9E2F10672Fc8e7871b401D7a24c82a78da71F78`; tokens `0xBae016c485053291E4759f2d43bC81e91581A30E`, `0x4feA188D57035F6A1CA0425bD7c65Bd21aC59Ad6` |
| Deploy mined hook | [0xc636e48c6dd73c65868fcd0b4aed4e4280bf68325eeab290bf7e06c8fc8d0247](https://explorer.testnet.arc.io/tx/0xc636e48c6dd73c65868fcd0b4aed4e4280bf68325eeab290bf7e06c8fc8d0247) | `WaveHook` `0x41cef812b6FF61419284E56f4380D4890cD28ac0` |
| Configure adapter and pool key | [0x170a2d6ae826650997c6365b976156753c537e80336fc57c0c0bfddb42a06258](https://explorer.testnet.arc.io/tx/0x170a2d6ae826650997c6365b976156753c537e80336fc57c0c0bfddb42a06258) | Adapter `0xD9E2F10672Fc8e7871b401D7a24c82a78da71F78` |
| Initialize pool and add bounded liquidity | [0x0e31cd9bae037ea82cb951d6ea0acb0d3c9434aff16034bf8989a178a9af7cbe](https://explorer.testnet.arc.io/tx/0x0e31cd9bae037ea82cb951d6ea0acb0d3c9434aff16034bf8989a178a9af7cbe) | Adapter `0xD9E2F10672Fc8e7871b401D7a24c82a78da71F78`; PoolManager `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |
| Execute compatibility swap | [0x4acb36973a7785d2e27a9218a3b124776419890cb9d861b48875650ea390ebc5](https://explorer.testnet.arc.io/tx/0x4acb36973a7785d2e27a9218a3b124776419890cb9d861b48875650ea390ebc5) | Adapter `0xD9E2F10672Fc8e7871b401D7a24c82a78da71F78`; PoolManager `0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A` |


## Phase B deployment (deployed, NOT yet current)

Deployed on Arc Testnet with `DeployPhaseB.s.sol`, `DeployWaveHook.s.sol` and `WirePhaseB.s.sol`; funded with `fund-phase-b.mjs`. `current.json` and the frontend still point at Phase A until the cutover. Roles were verified on-chain by `WirePhaseB` after broadcast. The old round's roles on `ProposerRegistry` and `QuantumLP`, and the old vault's roles on the old round and old resolver, were revoked.

| Contract | Address | Deploy tx | Verification |
|---|---|---|---|
| ProposalTokens (new) | [`0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E`](https://explorer.testnet.arc.io/address/0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E) | [0x857b1ddb…7453e9](https://explorer.testnet.arc.io/tx/0x857b1ddbcd351c35b68a996db24473275775119d2547033450a42c81157453e9) | [Sourcify match](https://explorer.testnet.arc.io/address/0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E) |
| WaveV4ProposalMarket (new) | [`0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A`](https://explorer.testnet.arc.io/address/0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A) | [0x501f0d29…bb337d](https://explorer.testnet.arc.io/tx/0x501f0d29fe413b8b277687805026ef49a7dac217e1ef75c483b8876eeabb337d) | [Sourcify match](https://explorer.testnet.arc.io/address/0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A) |
| QuantumRound (new) | [`0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5`](https://explorer.testnet.arc.io/address/0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5) | [0x6d3f3a3d…84a2c3](https://explorer.testnet.arc.io/tx/0x6d3f3a3d942ddb9fd117b0e783eec6e1035070620531f3fee5163e01b384a2c3) | [Sourcify match](https://explorer.testnet.arc.io/address/0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5) |
| Resolver (new) | [`0x74Fdf9F04589A9FE558D6F9D39D996b4FB4E9a48`](https://explorer.testnet.arc.io/address/0x74Fdf9F04589A9FE558D6F9D39D996b4FB4E9a48) | [0x313b2f29…f159f5](https://explorer.testnet.arc.io/tx/0x313b2f29c716dad63d60f47b800b889c9e65c71b027976e36d39f625d1f159f5) | [Sourcify match](https://explorer.testnet.arc.io/address/0x74Fdf9F04589A9FE558D6F9D39D996b4FB4E9a48) |
| WavefundVault (new) | [`0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865`](https://explorer.testnet.arc.io/address/0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865) | [0xb95c16de…ad065a](https://explorer.testnet.arc.io/tx/0xb95c16de313fd4e59fb1d45bb78779d61a86bf2d336a776e7dc0b01809ad065a) | [Sourcify match](https://explorer.testnet.arc.io/address/0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865) |
| WaveHook (new) | [`0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0`](https://explorer.testnet.arc.io/address/0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0) | [0x3dfac480…29b8f5](https://explorer.testnet.arc.io/tx/0x3dfac480012d5b97e2459cb9f1f69b83fc0293ca770719b60e65c8399029b8f5) | [Sourcify match](https://explorer.testnet.arc.io/address/0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0) |

Reused: tETH, ProposerRegistry, MockPriceOracle, QuantumLP, PoolManager, USDC. `ProposalTokens` is new because the Phase A instance is locked at 18-decimal credits; the new one uses `setCreditDecimals(6)`.

Wiring transactions: [0xec723ae9…f34e5f](https://explorer.testnet.arc.io/tx/0xec723ae9334b61a5fda606efa1e21f9b5b84d9f12d3c532c2132b9f294f34e5f), [0xbcd78450…df80df](https://explorer.testnet.arc.io/tx/0xbcd78450ea5afd547e842ae4251a466b5bd6a58d9f1c89728e485a48b0df80df), [0x2333eaf7…73b64a](https://explorer.testnet.arc.io/tx/0x2333eaf7c8122b083a7eda54dad5b92f252dc811b179f32e01c02ec92773b64a), [0xb9ca54c8…61ccb6](https://explorer.testnet.arc.io/tx/0xb9ca54c84489e29dfa0873c67dbad3768a8e197e562bc240a8224c302661ccb6), [0x9cd6b91b…5642ed](https://explorer.testnet.arc.io/tx/0x9cd6b91bac6c01951bf0360f8ac01527b38ac70082b84f4ebda539732c5642ed), [0x70c2c45c…48f2d3](https://explorer.testnet.arc.io/tx/0x70c2c45c737692bf9efbf02e05bd57b5e358b0e44888cdae3d48c0a6af48f2d3), [0x1140a279…c94a1c](https://explorer.testnet.arc.io/tx/0x1140a279497b537d03717ce9264926d5fceb2ae7a5940126184c3d4992c94a1c), [0x4b0c5d76…db5286](https://explorer.testnet.arc.io/tx/0x4b0c5d764d5465e6d91f939933ffe04e82ab56166b30fbc6ecfaaddd5adb5286), [0x8dea47ec…64d02c](https://explorer.testnet.arc.io/tx/0x8dea47ece28ac4ae039228ea2e6bf35450755074d680d269f4a2cfb55564d02c), [0x33f261de…a78dc2](https://explorer.testnet.arc.io/tx/0x33f261dec0e58fa5dbd535914c5578902c251b2a6b0e69226779c5bc1aa78dc2), [0x928318d5…200f43](https://explorer.testnet.arc.io/tx/0x928318d5e6fdbce3d018c053b12fad417ad6e64874afa7984aae00575a200f43), [0x4a9b1d6b…f4badf](https://explorer.testnet.arc.io/tx/0x4a9b1d6bc4a42d0d05b4679273956b02e87c73a09703f1d2affa012ca0f4badf), [0x21666497…fd9ae8](https://explorer.testnet.arc.io/tx/0x216664978eef5459f03d2419afbfc6cec2a25c3d54374b973f45be5ed4fd9ae8), [0x755b93b8…93cbe4](https://explorer.testnet.arc.io/tx/0x755b93b8371c8d6555b787b3e29fa0b666202986fb3dce95ff04d5468c93cbe4).

Funding: approve round seed (20 USDC) [0x3180e567…6651d5](https://explorer.testnet.arc.io/tx/0x3180e567891bf3ce8cc28608b46900d4afd7e2a161eb979d800ce82cf36651d5); addProtocolLiquiditySeed(20 USDC) [0x1573f354…783198](https://explorer.testnet.arc.io/tx/0x1573f354d13f636a3390fe173e48f4752b71add5b39832d1c660258e21783198); approve vault (5 USDC) [0x7bf074df…387e98](https://explorer.testnet.arc.io/tx/0x7bf074df8c4479005b0eb00beadebe2f85025eb30cc8158a4cc2c3abea387e98); fundVault(5 USDC) [0xccea3e3b…ee69d3](https://explorer.testnet.arc.io/tx/0xccea3e3bc9ea66a136315f7f7fd6d1be15499266dffa91c063736d1853ee69d3). `protocolLiquiditySeed` = 20 USDC (4 markets × 5 USDC); vault bootstrap = 5 USDC.

Gas: all three scripts cost about 0.37 USDC (priority fee 1 gwei, max fee 150 gwei, base fee 20 gwei).

## Phase A rescue check (correction)

Earlier notes said the Phase A `QuantumRound` had no rescue path. That was wrong: `rescueProtocolSeed(uint256)` exists on `0x82a6…Db41`, but it is capped by `protocolLiquiditySeed`, which is 0 (every seed was allocated to rounds 1–3 markets). The contract holds 31.043040 USDC that is not rescuable. Superseded vault `0xe4CE…b84D` is also no longer authorised on the old round or resolver.

## Blockscout (explorer) verification

Checked through `https://explorer.testnet.arc.io/api/v2/smart-contracts/<address>`: every contract below returns `is_verified: true` with source code, not only a Sourcify job. Phase B contracts were submitted with `forge verify-contract --verifier blockscout` (compiler 0.8.26, optimizer 200 runs, via-IR). The explorer reports `evm_version` as `cancun` and flags the matches as partial (metadata hash differs), which is how it records Sourcify/Blockscout mirrors.

| Contract | Explorer (verified source) |
|---|---|
| ProposalTokens (Phase B) | [`0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E`](https://explorer.testnet.arc.io/address/0xA3998Bb07BD324C886bf87965e66f32e4ABcCa4E#code) |
| WaveV4ProposalMarket | [`0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A`](https://explorer.testnet.arc.io/address/0x5A2DA260d3C7A7abd1Ae851D234022bd6699fa7A#code) |
| QuantumRound (Phase B) | [`0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5`](https://explorer.testnet.arc.io/address/0x74b798AcB0fD0Bfd219F4f6C770166e32648B0c5#code) |
| Resolver (Phase B) | [`0x74Fdf9F04589A9FE558D6F9D39D996b4FB4E9a48`](https://explorer.testnet.arc.io/address/0x74Fdf9F04589A9FE558D6F9D39D996b4FB4E9a48#code) |
| WavefundVault (Phase B) | [`0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865`](https://explorer.testnet.arc.io/address/0xA1E37Becb47A3566d98EF55d0A3c14FA54E69865#code) |
| WaveHook (Phase B) | [`0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0`](https://explorer.testnet.arc.io/address/0xA2FD9c9E3f7515868DE9d84394A5237901D98Ac0#code) |
| ProposalTokens (Phase A) | [`0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51`](https://explorer.testnet.arc.io/address/0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51#code) |
| QuantumRound (Phase A) | [`0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41`](https://explorer.testnet.arc.io/address/0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41#code) |
| Resolver (Phase A) | [`0xeA89585fb62e6eB63D101409093D88A94A936A4C`](https://explorer.testnet.arc.io/address/0xeA89585fb62e6eB63D101409093D88A94A936A4C#code) |
| WavefundVault (Phase A, superseded) | [`0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D`](https://explorer.testnet.arc.io/address/0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D#code) |
| ConstantProductMarket | [`0xEC6d767c62029A2868E1475873D9C2aE172F72df`](https://explorer.testnet.arc.io/address/0xEC6d767c62029A2868E1475873D9C2aE172F72df#code) |
| QuantumLP | [`0x885512902D1f5d05f81A678FdFFE0e339623c415`](https://explorer.testnet.arc.io/address/0x885512902D1f5d05f81A678FdFFE0e339623c415#code) |
| MockPriceOracle | [`0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d`](https://explorer.testnet.arc.io/address/0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d#code) |
| TestAsset (tETH) | [`0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d`](https://explorer.testnet.arc.io/address/0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d#code) |
| ProposerRegistry | [`0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346`](https://explorer.testnet.arc.io/address/0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346#code) |
| Throwaway compatibility WaveHook | [`0x41cef812b6FF61419284E56f4380D4890cD28ac0`](https://explorer.testnet.arc.io/address/0x41cef812b6FF61419284E56f4380D4890cD28ac0#code) |

Not verified: the throwaway compatibility adapter `0xD9E2…1F78` (test scaffolding from the Arc hook spike; submissions are accepted but do not match the current history).

## USDC/tETH vault pool: concentrated position (owned by the deployer)

The vault swaps USDC/tETH in the no-hook v4 pool (fee 0.30%, spacing 60). Depth comes from one concentrated position, plus ~9.2e9 of leftover full-range dust liquidity from the smoke tests.

- **Owner of record:** the v4 callback [`0xFaDBe81aF357757d2cd84e33883fe41579f88c97`](https://explorer.testnet.arc.io/address/0xFaDBe81aF357757d2cd84e33883fe41579f88c97) holds the position (salt 0). Its `execute()` is `owner`-only, and the owner is the deployer. Only the deployer can remove it.
- **Range:** −10% / +20% of the oracle price (USDC per tETH ≈ $2104.89 … $2824.27 at set-up; ticks 196860…199800). The −10% side holds the USDC for tETH→USDC sales; the +20% side is tETH only (tETH is a free mock token).
- **Cost:** ≈ 10.68 USDC + 0.0075 tETH, within the approved 11 USDC cap. Re-centring reuses the USDC already in the position (remove, align, re-add), so it only needs gas plus a ~0.04 USDC cap margin that is not spent.
- **Depth:** 2 USDC moves the spot price by ≈ 2.00% (execution price ≈ 1.30% worse than pre-trade spot including the 0.30% fee). 0.5 USDC: 0.50% spot / 0.55% effective; 1 USDC: 1.00% / 0.80%. Selling tETH worth 0.5 / 1 / 2 USDC: 0.50% / 0.99% / 1.96% spot.
- **Record:** `contracts/deployments/pool-position.json` stores the ticks; on-chain liquidity is read from the PoolManager.

Commands (run from `conviction/`, need `.env` with the deployer key):

| Command | Effect |
|---|---|
| `npm run pool:recenter` | Read-only plan and impact table. |
| `npm run pool:recenter -- --execute` | Remove the old position, align the pool to the Coinbase price, re-add −10%/+20% around it. Run before every demo. |
| `npm run pool:recenter -- --remove --execute` | Withdraw the whole position and all its USDC/tETH to the deployer. |
| `npm run pool:recenter -- --measure` | Print the price impact for 0.5 / 1 / 2 USDC buys and sells. |

`demo:open-round` warns when the pool price is within 5% of either range edge and refuses to open (outside `--test`) when depth is below the 2 USDC / 2% target.

Transactions (2026-10-25): first position add [`0xb1e7…b28a`](https://explorer.testnet.arc.io/tx/0xb1e7898b7404085f12307fdf0ccdb268819a1171c80046d024465c0983f5b28a) (align swap [`0x504d…4600`](https://explorer.testnet.arc.io/tx/0x504dde977e9ef40292d68b2c59209ef040867f9a5373fcbc4f4b02eeecc54600)); tested `--remove` [`0x569b…3994`](https://explorer.testnet.arc.io/tx/0x569b7e2205a9652d1b3c4ab282c30cd2cf945860b2f1b7473ebf8ef34a1f3994) (returned 10.680744 USDC + 0.007488 tETH); re-add (same position, ticks unchanged); recenter with reuse: remove [`0xd91b…d0ed`](https://explorer.testnet.arc.io/tx/0xd91bd1e16e164f0329af63b84ca78dec40ea9018b2a0cf5c76f489fd2c5f35ed), add [`0x756a…df9d`](https://explorer.testnet.arc.io/tx/0x756a160d38192b0a1d8a427fae20bd673d89c37989c4f56335a02e02c39fdf9d).
