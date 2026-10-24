import { createPublicClient, defineChain, getAddress, http, parseAbi } from "viem";

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
});

export const addresses = {
  usdc: getAddress("0x3600000000000000000000000000000000000000"),
  tEth: getAddress("0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d"),
  proposalTokens: getAddress("0x328C5d7a02C4B29162e2F80520C89Ec9AfE5bD51"),
  proposerRegistry: getAddress("0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346"),
  market: getAddress("0xEC6d767c62029A2868E1475873D9C2aE172F72df"),
  quantumRound: getAddress("0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41"),
  resolver: getAddress("0xeA89585fb62e6eB63D101409093D88A94A936A4C"),
  vault: getAddress("0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D"),
  legacyVault: getAddress("0x65648366C96Af7b3c2ECdC1B78A06d975A1505F3"),
  priceOracle: getAddress("0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d"),
  quantumLp: getAddress("0x885512902D1f5d05f81A678FdFFE0e339623c415"),
} as const;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

export const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

export const quantumRoundAbi = parseAbi([
  "function roundCount() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
  "function proposals(uint256,uint256) view returns (uint256 id,address proposer,uint16 tEthBps,string rationaleURI,uint256 bondAmount,bool bondRefunded,bool isStatusQuo)",
  "function deposits(uint256,address) view returns (uint256)",
  "function creditsClaimed(uint256,uint256,address) view returns (uint256)",
  "function totalCreditsClaimed(uint256,address) view returns (uint256)",
  "function market() view returns (address)",
  "function proposalTokens() view returns (address)",
  "function deposit(uint256,uint256)",
  "function claimCredits(uint256,uint256,uint256)",
  "function buyLong(uint256,uint256,uint256,uint256)",
  "function buyShort(uint256,uint256,uint256,uint256)",
  "function sellLong(uint256,uint256,uint256,uint256)",
  "function sellShort(uint256,uint256,uint256,uint256)",
  "function collapse(uint256)",
  "function redeem(uint256)",
]);

export const proposalMarketAbi = parseAbi([
  "function feeBps() view returns (uint16)",
  "function markets(uint256,uint256) view returns (uint128 creditReserve,uint128 longReserve,uint128 shortIssued,bool seeded,uint256 twapAccumulator,uint256 twapLastPrice,uint256 twapLastUpdate)",
  "function spotPrice(uint256,uint256) view returns (uint256)",
]);

export const proposalTokensAbi = parseAbi([
  "function creditToken(uint256,uint256) view returns (address)",
  "function longToken(uint256,uint256) view returns (address)",
  "function shortToken(uint256,uint256) view returns (address)",
]);

export const vaultAbi = parseAbi([
  "function totalVaultUsdc() view returns (uint256)",
  "function totalVaultTEth() view returns (uint256)",
  "function totalQueuedDepositUsdc() view returns (uint256)",
  "function totalQueuedWithdrawalShares() view returns (uint256)",
  "function queuedDepositUsdc(address) view returns (uint256)",
  "function queuedWithdrawalShares(address) view returns (uint256)",
  "function requestDeposit(uint256)",
  "function requestWithdraw(uint256)",
  "function cancelDepositRequest()",
  "function cancelWithdrawRequest()",
  "function spotPriceTEthInUsdc() view returns (uint256)",
  "function oraclePriceTEthInUsdc() view returns (uint256)",
  "function roundState(uint256) view returns (uint256 startValueUsdc,uint256 tEthAtStart,uint256 usdcAtStart,uint256 startPriceUsdc,uint64 navTimestamp,bool executed,bool reported,bool cancelled)",
]);
