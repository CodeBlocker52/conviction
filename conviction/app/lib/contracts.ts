import { createPublicClient, defineChain, getAddress, http } from "viem";
import deployment from "../../contracts/deployments/current.json";
import {
  constantProductMarketAbi,
  erc20Abi,
  mockPriceOracleAbi,
  poolManagerAbi,
  proposerRegistryAbi,
  proposalTokensAbi,
  quantumLpAbi,
  quantumRoundAbi,
  resolverAbi,
  testAssetAbi,
  v4CallbackAbi,
  wavefundVaultAbi,
} from "./generated/contract-abis";

export const arcTestnet = defineChain({
  id: deployment.chainId,
  name: deployment.chainName,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
  blockExplorers: { default: { name: "Arc Explorer", url: deployment.explorerUrl } },
});

export const addresses = {
  usdc: getAddress(deployment.contracts.usdc),
  tEth: getAddress(deployment.contracts.testAsset),
  proposalTokens: getAddress(deployment.contracts.proposalTokens),
  proposerRegistry: getAddress(deployment.contracts.proposerRegistry),
  market: getAddress(deployment.contracts.market),
  quantumRound: getAddress(deployment.contracts.quantumRound),
  resolver: getAddress(deployment.contracts.resolver),
  vault: getAddress(deployment.contracts.vault),
  quantumLp: getAddress(deployment.contracts.quantumLp),
  priceOracle: getAddress(deployment.contracts.priceOracle),
  poolManager: getAddress(deployment.contracts.poolManager),
  positionManager: getAddress(deployment.contracts.positionManager),
  permit2: getAddress(deployment.contracts.permit2),
  v4Callback: getAddress(deployment.contracts.v4Callback),
} as const;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(deployment.rpcUrl),
});

export {
  constantProductMarketAbi as proposalMarketAbi,
  erc20Abi,
  mockPriceOracleAbi,
  poolManagerAbi,
  proposerRegistryAbi,
  proposalTokensAbi,
  quantumLpAbi,
  quantumRoundAbi,
  resolverAbi,
  testAssetAbi,
  v4CallbackAbi,
  wavefundVaultAbi as vaultAbi,
};
