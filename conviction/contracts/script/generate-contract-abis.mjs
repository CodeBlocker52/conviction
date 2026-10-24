import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const generatedPath = resolve(root, "app/lib/generated/contract-abis.ts");
const manifestPath = resolve(root, "app/lib/generated/contract-abis.json");
const artifactDefinitions = [
  ["testAssetAbi", "contracts/out/TestAsset.sol/TestAsset.json"],
  ["proposalTokensAbi", "contracts/out/ProposalTokens.sol/ProposalTokens.json"],
  ["proposerRegistryAbi", "contracts/out/ProposerRegistry.sol/ProposerRegistry.json"],
  ["constantProductMarketAbi", "contracts/out/ConstantProductMarket.sol/ConstantProductMarket.json"],
  ["quantumRoundAbi", "contracts/out/QuantumRound.sol/QuantumRound.json"],
  ["resolverAbi", "contracts/out/Resolver.sol/Resolver.json"],
  ["wavefundVaultAbi", "contracts/out/WavefundVault.sol/WavefundVault.json"],
  ["quantumLpAbi", "contracts/out/QuantumLP.sol/QuantumLP.json"],
  ["mockPriceOracleAbi", "contracts/out/MockPriceOracle.sol/MockPriceOracle.json"],
  ["poolManagerAbi", "contracts/out/IExtsload.sol/IExtsload.json"],
  ["v4CallbackAbi", "contracts/out/V4SmokeTest.s.sol/TestCallback.json"],
];

function artifactAbi(relativePath) {
  const artifactPath = resolve(root, relativePath);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read Forge artifact ${relativePath}; run forge build first.`, { cause: error });
  }
  if (!Array.isArray(artifact.abi)) throw new Error(`Forge artifact ${relativePath} has no ABI.`);
  return artifact.abi;
}

const standardErc20Functions = new Set([
  "allowance",
  "approve",
  "balanceOf",
  "totalSupply",
]);
const testAssetAbi = artifactAbi("contracts/out/TestAsset.sol/TestAsset.json");
const erc20Abi = testAssetAbi.filter(
  (item) => item.type === "function" && standardErc20Functions.has(item.name),
);

const output = [
  'import type { Abi } from "viem";',
  "",
  ...artifactDefinitions.flatMap(([exportName, relativePath]) => [
    `export const ${exportName} = ${JSON.stringify(artifactAbi(relativePath), null, 2)} as const satisfies Abi;`,
    "",
  ]),
  `export const erc20Abi = ${JSON.stringify(erc20Abi, null, 2)} as const satisfies Abi;`,
  "",
].join("\n");

const manifest = Object.fromEntries([
  ...artifactDefinitions.map(([exportName, relativePath]) => [exportName, artifactAbi(relativePath)]),
  ["erc20Abi", erc20Abi],
]);
mkdirSync(dirname(generatedPath), { recursive: true });
writeFileSync(generatedPath, output);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${artifactDefinitions.length + 1} ABIs from Forge artifacts.`);
