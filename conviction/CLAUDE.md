# Claude Project Notes

Follow [`AGENTS.md`](./AGENTS.md) for project rules, verified deployments, Arc-specific behavior, and current upgrade status.

Key constraints:
- Arc USDC's ERC-20 interface uses 6 decimals; tETH uses 18 decimals. Arc's native USDC gas balance is an 18-decimal view and must not be added to the ERC-20 balance.
- Forge simulation fails on USDC transfers because it does not reproduce Arc's blocklist precompile. Use Foundry for local builds/tests and viem or `cast send` against the real Arc RPC for actual USDC-moving transactions.
- Do not add wagmi; the frontend uses plain viem and a `useWallet` hook.
- The current price-control source uses a keeper-updated 8-decimal ETH/USD oracle (refresh every 60 seconds and before NAV/resolution), a 5-minute freshness limit, a 500 bps slippage cap, a 10-proposal round limit, and admin rescue limited to unallocated protocol seed. The deployment plan replaces QuantumLP so user withdrawals are not globally locked.
- Reuse only TestAsset, ProposalTokens, and ProposerRegistry after confirming their old-round references are role-based; revoke the old round's permissions before wiring the new round. Re-deploy contracts with immutable old-round references.
