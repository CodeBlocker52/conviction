# Claude Project Notes

Follow [`AGENTS.md`](./AGENTS.md) for project rules, the current (Phase B) deployment, Arc-specific behaviour and commands. Addresses come from `contracts/deployments/current.json`; Phase A is superseded and must not be used.

Key constraints:
- USDC ERC-20 is 6 decimals; credits are 6; LONG/SHORT/WAVE/tETH are 18. Arc's native gas balance is an 18-decimal view of USDC and must not be added to the ERC-20 balance.
- Forge simulation fails on USDC transfers (Arc blocklist precompile). Use Foundry for builds/tests and viem or `cast send` against the real RPC for anything that moves USDC.
- Do not add wagmi; use plain viem and the `useWallet` hook. Reads go through Multicall3 and the fallback transport in `app/lib/rpc.ts`.
- Trades use the adapter's `quote*` views with 0.5% slippage; implied return is `rMin + pLong × (rMax − rMin)`. Bonds are all refunded at collapse.
- Before any broadcast: priority fee 1 gwei, max fee ≈ 2× base fee. Never commit or print `.env` values.
- Run `npm run build`, `npm run check:contracts` and `npx tsc --noEmit` before pushing.
