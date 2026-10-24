# Wavefund Phase A — Arc Testnet Deployment and Sources

## Network and operating rules

- Chain: Arc Testnet, chain ID `5042002`
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://explorer.testnet.arc.io`
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals)
- Native gas asset: USDC-denominated, 18 decimals. Do not combine its balance with ERC-20 USDC.
- Arc's blocklist precompile makes Foundry simulation unreliable for USDC transfers. Use the project's viem scripts against the real RPC for token-moving actions; use Forge for build, tests, and deployments that do not move USDC.
- Source configuration: Solidity `0.8.26`, Osaka EVM, `via_ir = true`; Uniswap v4 core `1.0.2`.

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

The v4 smoke test and deployment funding are complete. `contracts/script/demo-round.mjs` is ready to run with `npm run demo:round`. Its planned principal is 3.6 USDC from the deployer (0.1 vault bootstrap, two 1-USDC proposal bonds, and a 1.5-USDC round deposit) and 2.5 USDC from the keeper (one 1-USDC bond and a 1.5-USDC round deposit), plus transaction fees. Arc charges fees in USDC, so keep additional USDC available for gas. The latest preflight balance check showed 60.356605 USDC for the deployer and 40.096914 USDC for the keeper; the round had not yet been opened. The script refuses to proceed unless the vault is empty, the required seed and keeper role are present, the balances meet its checks, and the v4 spot is within 450 bps of Coinbase.
