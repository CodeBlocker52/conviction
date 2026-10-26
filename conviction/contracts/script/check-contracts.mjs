import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  toFunctionSelector,
  toHex,
} from "viem";

const root = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

function findForge() {
  const pathLookup = spawnSync("which", ["forge"], { encoding: "utf8" });
  const fromPath = pathLookup.status === 0 ? pathLookup.stdout.trim() : "";
  if (fromPath) return fromPath;

  const foundryInstall = resolve(homedir(), ".foundry/bin/forge");
  return existsSync(foundryInstall) ? foundryInstall : null;
}

const forge = findForge();
if (forge) {
  run(forge, ["build"]);
} else {
  console.warn("Forge is unavailable in this build environment; validating the checked-in generated ABI manifest.");
}

const deployment = JSON.parse(readFileSync(resolve(root, "contracts/deployments/current.json"), "utf8"));
const sources = readFileSync(resolve(root, "contracts/deployments/SOURCES.md"), "utf8");
const abis = JSON.parse(readFileSync(resolve(root, "app/lib/generated/contract-abis.json"), "utf8"));
const chain = defineChain({
  id: deployment.chainId,
  name: deployment.chainName,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
const abiChecks = [
  ["TestAsset", abis.testAssetAbi, deployment.contracts.testAsset],
  ["ProposalTokens", abis.proposalTokensAbi, deployment.contracts.proposalTokens],
  ["ProposerRegistry", abis.proposerRegistryAbi, deployment.contracts.proposerRegistry],
  ["WaveV4ProposalMarket", abis.waveMarketAbi, deployment.contracts.market],
  ["WaveHook", abis.waveHookAbi, deployment.contracts.waveHook],
  ["QuantumRound", abis.quantumRoundAbi, deployment.contracts.quantumRound],
  ["Resolver", abis.resolverAbi, deployment.contracts.resolver],
  ["WavefundVault", abis.wavefundVaultAbi, deployment.contracts.vault],
  ["QuantumLP", abis.quantumLpAbi, deployment.contracts.quantumLp],
  ["MockPriceOracle", abis.mockPriceOracleAbi, deployment.contracts.priceOracle],
  ["PoolManager", abis.poolManagerAbi, deployment.contracts.poolManager],
  ["V4 callback", abis.v4CallbackAbi, deployment.contracts.v4Callback],
];
const sourceLabels = [
  ["TestAsset (tETH, reused)", deployment.contracts.testAsset],
  ["ProposalTokens", deployment.contracts.proposalTokens],
  ["ProposerRegistry (reused)", deployment.contracts.proposerRegistry],
  ["WaveV4ProposalMarket", deployment.contracts.market],
  ["WaveHook", deployment.contracts.waveHook],
  ["QuantumRound", deployment.contracts.quantumRound],
  ["Resolver", deployment.contracts.resolver],
  ["WavefundVault (queued WAVE shares)", deployment.contracts.vault],
  ["QuantumLP (reused)", deployment.contracts.quantumLp],
  ["MockPriceOracle (reused)", deployment.contracts.priceOracle],
  ["Uniswap v4 PoolManager", deployment.contracts.poolManager],
  ["Uniswap v4 PositionManager", deployment.contracts.positionManager],
  ["Permit2", deployment.contracts.permit2],
];

if (await client.getChainId() !== deployment.chainId) {
  throw new Error(`Configured RPC is not ${deployment.chainName} (chain ${deployment.chainId}).`);
}

for (const [label, address] of sourceLabels) {
  const matchingRow = sources.split("\n").find((line) => line.startsWith(`| ${label} |`));
  if (!matchingRow?.toLowerCase().includes(address.toLowerCase())) {
    throw new Error(`${label} address in current.json does not match SOURCES.md: ${address}`);
  }
}
for (const [label, address] of [
  ["USDC (predeploy)", deployment.contracts.usdc],
  ["v4 smoke-test callback", deployment.contracts.v4Callback],
]) {
  if (!sources.toLowerCase().includes(address.toLowerCase())) {
    throw new Error(`${label} address is missing from SOURCES.md: ${address}`);
  }
}

const configuredAddresses = Object.entries(deployment.contracts);
const deployedBytecode = new Map();
for (const [name, address] of configuredAddresses) {
  const code = await client.getBytecode({ address });
  if (!code || code === "0x") throw new Error(`${name} has no code on ${deployment.chainName}: ${address}`);
  deployedBytecode.set(address.toLowerCase(), code.slice(2).toLowerCase());
}

function checkAbi(label, abi, address) {
  if (!Array.isArray(abi)) throw new Error(`${label} has no generated ABI.`);
  const bytecode = deployedBytecode.get(address.toLowerCase());
  if (!bytecode) throw new Error(`${label} address is not present in current.json: ${address}`);
  const functions = abi.filter((item) => item.type === "function");
  const missing = functions.filter((item) => !bytecode.includes(toFunctionSelector(item).slice(2).toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`${label} ABI selectors absent from deployed bytecode: ${missing.map((item) => item.name).join(", ")}`);
  }
  console.log(`${label}: ${functions.length} ABI function selectors found at ${address}.`);
}

for (const [label, abi, address] of abiChecks) checkAbi(label, abi, address);

for (const [contractAddress, abi, functionName, expectedAddress] of [
  [deployment.contracts.quantumRound, abis.quantumRoundAbi, "market", deployment.contracts.market],
  [deployment.contracts.quantumRound, abis.quantumRoundAbi, "proposalTokens", deployment.contracts.proposalTokens],
  [deployment.contracts.quantumRound, abis.quantumRoundAbi, "proposerRegistry", deployment.contracts.proposerRegistry],
  [deployment.contracts.quantumRound, abis.quantumRoundAbi, "resolver", deployment.contracts.resolver],
  [deployment.contracts.market, abis.waveMarketAbi, "waveHook", deployment.contracts.waveHook],
  [deployment.contracts.market, abis.waveMarketAbi, "quantumRound", deployment.contracts.quantumRound],
  [deployment.contracts.market, abis.waveMarketAbi, "proposalTokens", deployment.contracts.proposalTokens],
  [deployment.contracts.market, abis.waveMarketAbi, "poolManager", deployment.contracts.poolManager],
  [deployment.contracts.waveHook, abis.waveHookAbi, "adapter", deployment.contracts.market],
  [deployment.contracts.vault, abis.wavefundVaultAbi, "quantumRound", deployment.contracts.quantumRound],
  [deployment.contracts.vault, abis.wavefundVaultAbi, "resolver", deployment.contracts.resolver],
  [deployment.contracts.vault, abis.wavefundVaultAbi, "priceOracle", deployment.contracts.priceOracle],
  [deployment.contracts.vault, abis.wavefundVaultAbi, "poolManager", deployment.contracts.poolManager],
  [deployment.contracts.vault, abis.wavefundVaultAbi, "tEth", deployment.contracts.testAsset],
]) {
  const linkedAddress = await client.readContract({
    address: contractAddress,
    abi,
    functionName,
  });
  if (typeof linkedAddress !== "string" || linkedAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`${functionName} wired into ${contractAddress} does not match current.json (${expectedAddress}).`);
  }
}

const creditDecimals = await client.readContract({
  address: deployment.contracts.proposalTokens,
  abi: abis.proposalTokensAbi,
  functionName: "creditDecimals",
});
if (Number(creditDecimals) !== 6) throw new Error(`ProposalTokens.creditDecimals is ${creditDecimals}, expected 6.`);

const roleChecks = [
  [deployment.contracts.proposalTokens, abis.proposalTokensAbi, "QUANTUM_ROUND_ROLE", deployment.contracts.quantumRound],
  [deployment.contracts.proposerRegistry, abis.proposerRegistryAbi, "QUANTUM_ROUND_ROLE", deployment.contracts.quantumRound],
  [deployment.contracts.quantumLp, abis.quantumLpAbi, "QUANTUM_ROUND_ROLE", deployment.contracts.quantumRound],
  [deployment.contracts.quantumRound, abis.quantumRoundAbi, "VAULT_ROLE", deployment.contracts.vault],
  [deployment.contracts.quantumRound, abis.quantumRoundAbi, "KEEPER_ROLE", deployment.keeper],
  [deployment.contracts.vault, abis.wavefundVaultAbi, "QUANTUM_ROUND_ROLE", deployment.contracts.quantumRound],
  [deployment.contracts.resolver, abis.resolverAbi, "RESOLVER_ROLE", deployment.contracts.vault],
];
for (const [address, abi, role, account] of roleChecks) {
  const granted = await client.readContract({
    address,
    abi,
    functionName: "hasRole",
    args: [keccak256(toHex(role)), account],
  });
  if (!granted) throw new Error(`${role} is not granted to ${account} on ${address}.`);
}
const marketOwner = await client.readContract({
  address: deployment.contracts.market,
  abi: abis.waveMarketAbi,
  functionName: "owner",
});
if (marketOwner.toLowerCase() !== deployment.contracts.quantumRound.toLowerCase()) {
  throw new Error(`Adapter owner ${marketOwner} is not the QuantumRound.`);
}
console.log("ProposalTokens credit decimals are 6 and Phase B roles are wired correctly.");

for (const [label, address] of [
  ["tETH", deployment.contracts.testAsset],
  ["WavefundVault shares", deployment.contracts.vault],
]) {
  checkAbi(`${label} ERC-20`, abis.erc20Abi, address);
}

async function checkErc20Calls(label, address) {
  for (const [functionName, args] of [
    ["allowance", [deployment.admin, deployment.admin]],
    ["approve", [deployment.admin, 0n]],
    ["balanceOf", [deployment.admin]],
    ["totalSupply", []],
  ]) {
    const data = encodeFunctionData({ abi: abis.erc20Abi, functionName, args });
    const result = await client.call({ account: deployment.admin, to: address, data });
    if (!result.data || result.data === "0x") {
      throw new Error(`${label} did not return data for ${functionName}.`);
    }
  }
}

await checkErc20Calls("Arc USDC", deployment.contracts.usdc);
await checkErc20Calls("tETH", deployment.contracts.testAsset);
await checkErc20Calls("WavefundVault shares", deployment.contracts.vault);

const roundCount = await client.readContract({
  address: deployment.contracts.quantumRound,
  abi: abis.quantumRoundAbi,
  functionName: "roundCount",
});
for (let roundId = 1n; roundId <= roundCount; roundId += 1n) {
  const round = await client.readContract({
    address: deployment.contracts.quantumRound,
    abi: abis.quantumRoundAbi,
    functionName: "rounds",
    args: [roundId],
  });
  for (let proposalId = 0n; proposalId < round[7]; proposalId += 1n) {
    for (const tokenFunction of ["creditToken", "longToken", "shortToken"]) {
      const token = await client.readContract({
        address: deployment.contracts.proposalTokens,
        abi: abis.proposalTokensAbi,
        functionName: tokenFunction,
        args: [roundId, proposalId],
      });
      const code = await client.getBytecode({ address: token });
      if (!code || code === "0x") throw new Error(`${tokenFunction}(${roundId}, ${proposalId}) has no deployed token code.`);
      await checkErc20Calls(`Proposal ${roundId}/${proposalId} ${tokenFunction}`, token);
    }
  }
}

console.log("Arc USDC and deployed ERC-20 token calls succeeded.");
console.log(`Verified code at all ${configuredAddresses.length} configured addresses and checked current deployment sources.`);
