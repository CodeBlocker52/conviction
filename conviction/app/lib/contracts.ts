import { createPublicClient, getAddress } from "viem";
import { arcTestnet, readTransport } from "./rpc";
import deployment from "../../contracts/deployments/current.json";
import {
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
  waveHookAbi,
  waveMarketAbi,
  wavefundVaultAbi,
} from "./generated/contract-abis";

export { arcTestnet } from "./rpc";

export const addresses = {
  usdc: getAddress(deployment.contracts.usdc),
  tEth: getAddress(deployment.contracts.testAsset),
  proposalTokens: getAddress(deployment.contracts.proposalTokens),
  proposerRegistry: getAddress(deployment.contracts.proposerRegistry),
  market: getAddress(deployment.contracts.market),
  waveHook: getAddress(deployment.contracts.waveHook),
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
  transport: readTransport,
  batch: { multicall: { wait: 20, batchSize: 8_192 } },
});

export {
  waveMarketAbi as proposalMarketAbi,
  waveMarketAbi,
  waveHookAbi,
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
