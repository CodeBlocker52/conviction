import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import {
  accountFor,
  assertArcTestnet,
  callbackAbi,
  chain,
  confirm,
  deployment,
  ensureAllowance,
  erc20Abi,
  explorerUrl,
  fetchCoinbasePrice,
  poolManagerAbi,
  publicClient,
  registryAbi,
  roundAbi,
  sendContract,
  startOracleWatcher,
  usdc,
  usdcAbi,
  vaultAbi,
  walletClientFor,
} from "./demo-round-common.mjs";

const { contracts } = deployment;
const deployerAddress = deployment.admin;
const keeperAddress = deployment.keeper;
const callbackAddress = contracts.v4Callback;
const fee = 3_000;
const tickSpacing = 60;
const minTick = -887_220;
const maxTick = 887_220;
const q96 = 1n << 96n;
const maxUint256 = (1n << 256n) - 1n;
const gasReserveUsdc = 100_000n;
const poolKey = {
  currency0: contracts.usdc,
  currency1: contracts.testAsset,
  fee,
  tickSpacing,
  hooks: "0x0000000000000000000000000000000000000000",
};
const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
};
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const testMode = args.includes("--test");
const minutesIndex = args.indexOf("--minutes");
const tradingMinutes = minutesIndex === -1
  ? Number(process.env.DEMO_TRADING_WINDOW_MINUTES ?? 15)
  : Number(args[minutesIndex + 1]);
if (!Number.isInteger(tradingMinutes) || tradingMinutes < 3 || tradingMinutes > 1_440) {
  throw new Error("Trading window must be between 3 and 1440 whole minutes.");
}

function liquidityAmountsInRange(liquidity, sqrtPriceX96, sqrtLower, sqrtUpper) {
  if (liquidity === 0n) return { usdcMax: 0n, tEthMax: 0n };
  const amount0 = sqrtPriceX96 >= sqrtUpper
    ? 0n
    : ceilDiv(liquidity * (sqrtUpper - sqrtPriceX96) * q96, sqrtPriceX96 * sqrtUpper);
  const amount1 = sqrtPriceX96 <= sqrtLower
    ? 0n
    : ceilDiv(liquidity * (sqrtPriceX96 - sqrtLower), q96);
  return {
    usdcMax: ceilMulDiv(amount0, 10_100n, 10_000n) + 1n,
    tEthMax: ceilMulDiv(amount1, 10_100n, 10_000n) + 1n,
  };
}

function concentratedRangeAtOracle(sqrtPriceX96) {
  const lowerTarget = sqrt((sqrtPriceX96 * sqrtPriceX96 * 9_000n) / 10_000n);
  const upperTarget = sqrt((sqrtPriceX96 * sqrtPriceX96 * 11_000n) / 10_000n);
  const toTick = (sqrtValue) => (
    2 * Math.log(Number(sqrtValue) / Number(q96)) / Math.log(1.0001)
  );
  const lowerTick = Math.max(minTick, Math.floor(toTick(lowerTarget) / tickSpacing) * tickSpacing);
  const upperTick = Math.min(maxTick, Math.ceil(toTick(upperTarget) / tickSpacing) * tickSpacing);
  return { sqrtLower: sqrtPriceAtTick(lowerTick), sqrtUpper: sqrtPriceAtTick(upperTick) };
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function sqrt(value) {
  if (value < 2n) return value;
  let x = value >> 1n;
  let y = (x + value / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

function sqrtPriceAtTick(tick) {
  const absoluteTick = Math.abs(tick);
  if (absoluteTick > 887_272) throw new Error(`Tick is out of range: ${tick}`);
  const constants = [
    0xfffcb933bd6fad37aa2d162d1a594001n,
    0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac4131762b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061e5n,
    0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ];
  let ratio = (absoluteTick & 1) === 1 ? constants[0] : 1n << 128n;
  for (let bit = 1; bit < constants.length; bit += 1) {
    if ((absoluteTick & (1 << bit)) !== 0) ratio = (ratio * constants[bit]) >> 128n;
  }
  if (tick > 0) ratio = maxUint256 / ratio;
  return (ratio >> 32n) + ((ratio & ((1n << 32n) - 1n)) === 0n ? 0n : 1n);
}

function ceilMulDiv(a, b, denominator) {
  return ceilDiv(a * b, denominator);
}

async function readPoolState() {
  const poolId = keccak256(encodeAbiParameters([poolKeyType], [poolKey]));
  // Uniswap v4-core 1.0.2 stores _pools at slot 6 and active liquidity at State slot 3.
  const mappingSlot = BigInt(keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }],
    [poolId, 6n],
  )));
  const [slot0, liquidityWord, spotPrice] = await Promise.all([
    publicClient.readContract({
      address: contracts.poolManager,
      abi: poolManagerAbi,
      functionName: "extsload",
      args: [toHex(mappingSlot, { size: 32 })],
    }),
    publicClient.readContract({
      address: contracts.poolManager,
      abi: poolManagerAbi,
      functionName: "extsload",
      args: [toHex(mappingSlot + 3n, { size: 32 })],
    }),
    publicClient.readContract({
      address: contracts.vault,
      abi: vaultAbi,
      functionName: "spotPriceTEthInUsdc",
    }),
  ]);
  const sqrtPriceX96 = BigInt(slot0) & ((1n << 160n) - 1n);
  const liquidity = BigInt(liquidityWord) & ((1n << 128n) - 1n);
  if (sqrtPriceX96 === 0n || liquidity === 0n) {
    throw new Error("The USDC/tETH v4 pool is uninitialized or has no active liquidity.");
  }
  return { poolId, sqrtPriceX96, liquidity, spotPrice };
}

function liquidityForImpact(sqrtPriceX96, maxImpactBps) {
  const targetSqrt = sqrt((sqrtPriceX96 * sqrtPriceX96 * 10_000n) / (10_000n + BigInt(maxImpactBps)));
  const netOneUsdc = 1_000_000n * BigInt(1_000_000 - fee) / 1_000_000n;
  return ceilDiv(
    netOneUsdc * targetSqrt * sqrtPriceX96,
    q96 * (sqrtPriceX96 - targetSqrt),
  );
}

function liquidityAmounts(liquidity, sqrtPriceX96) {
  if (liquidity === 0n) return { usdcMax: 0n, tEthMax: 0n };
  const sqrtLower = sqrtPriceAtTick(minTick);
  const sqrtUpper = sqrtPriceAtTick(maxTick);
  const amount0 = ceilDiv(
    liquidity * (sqrtUpper - sqrtPriceX96) * q96,
    sqrtPriceX96 * sqrtUpper,
  );
  const amount1 = ceilDiv(liquidity * (sqrtPriceX96 - sqrtLower), q96);
  return {
    usdcMax: ceilMulDiv(amount0, 10_100n, 10_000n) + 1n,
    tEthMax: ceilMulDiv(amount1, 10_100n, 10_000n) + 1n,
  };
}

function rebalancePlan(sqrtPriceX96, currentPrice, oraclePrice, liquidity) {
  const deviation = currentPrice > oraclePrice ? currentPrice - oraclePrice : oraclePrice - currentPrice;
  const deviationBps = deviation * 10_000n / oraclePrice;
  if (deviationBps <= 50n) {
    return { deviationBps, direction: null, amountIn: 0n, expectedOut: 0n, sqrtTarget: sqrtPriceX96 };
  }

  const sqrtTarget = sqrt((sqrtPriceX96 * sqrtPriceX96 * currentPrice) / oraclePrice);
  if (sqrtTarget === sqrtPriceX96) {
    throw new Error("Pool rebalance target is below the pool's representable price precision.");
  }
  if (currentPrice > oraclePrice) {
    const amountInNet = ceilDiv(liquidity * (sqrtTarget - sqrtPriceX96), q96);
    const amountIn = ceilDiv(amountInNet * 1_000_000n, BigInt(1_000_000 - fee));
    const expectedOut = (liquidity * q96 * (sqrtTarget - sqrtPriceX96))
      / (sqrtTarget * sqrtPriceX96);
    return { deviationBps, direction: "tETH", amountIn, expectedOut, sqrtTarget };
  }
  const amountInNet = ceilDiv(
    liquidity * q96 * (sqrtPriceX96 - sqrtTarget),
    sqrtTarget * sqrtPriceX96,
  );
  const amountIn = ceilDiv(amountInNet * 1_000_000n, BigInt(1_000_000 - fee));
  const expectedOut = (liquidity * (sqrtPriceX96 - sqrtTarget)) / q96;
  return { deviationBps, direction: "USDC", amountIn, expectedOut, sqrtTarget };
}

async function callCallback(account, data) {
  const encoded = await publicClient.call({
    account,
    to: callbackAddress,
    data: encodeFunctionData({ abi: callbackAbi, functionName: "execute", args: [data] }),
  });
  if (!encoded.data || encoded.data === "0x") throw new Error("Callback simulation returned no data.");
  return decodeAbiParameters([{ type: "bytes" }], encoded.data)[0];
}

async function sendCallback(label, walletClient, payload) {
  const hash = await walletClient.sendTransaction({
    account: walletClient.account,
    chain,
    to: callbackAddress,
    data: encodeFunctionData({ abi: callbackAbi, functionName: "execute", args: [payload] }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${explorerUrl}/tx/${hash}`);
  return hash;
}

function printPlan({
  quote,
  oraclePrice,
  pool,
  liquidityToAdd,
  liquidityCaps,
  fullRangeCaps,
  concentratedCaps,
  rebalance,
  seed,
  seedDeficit,
  perProposal,
  bond,
  balances,
}) {
  const bondRequirement = bond * 2n;
  const keeperBondRequirement = bond;
  const usdcRequirement = liquidityCaps.usdcMax
    + (rebalance.direction === "USDC" ? rebalance.amountIn : 0n)
    + bondRequirement
    + gasReserveUsdc;
  const tEthRequirement = liquidityCaps.tEthMax + (rebalance.direction === "tETH" ? rebalance.amountIn : 0n);
  console.log(`Fresh Coinbase ETH/USD quote: $${quote}`);
  console.log(`Current v4 spot: ${usdc(pool.spotPrice)} USDC/tETH`);
  console.log(`Oracle target: ${usdc(oraclePrice)} USDC/tETH`);
  console.log(`Current deviation: ${Number(rebalance.deviationBps) / 100}% (limit 0.50%)`);
  if (testMode) {
    console.log("TEST MODE: no deep-liquidity addition; only align the existing pool, then open a low-cost round.");
    console.log("Real-demo depth target: under 0.90% spot impact for a 1 USDC exact-input trade.");
    console.log(`Full-range depth contribution estimate: ${usdc(fullRangeCaps.usdcMax)} USDC and ${usdc(fullRangeCaps.tEthMax, 18)} tETH`);
    console.log(`Concentrated ±10% contribution estimate: ${usdc(concentratedCaps.usdcMax)} USDC and ${usdc(concentratedCaps.tEthMax, 18)} tETH`);
    const fullCost = fullRangeCaps.usdcMax + (fullRangeCaps.tEthMax * oraclePrice) / 10n ** 18n;
    const concentratedCost = concentratedCaps.usdcMax + (concentratedCaps.tEthMax * oraclePrice) / 10n ** 18n;
    const savingsBps = fullCost === 0n ? 0n : (fullCost - concentratedCost) * 10_000n / fullCost;
    console.log(`Concentrated liquidity needs approximately ${Number(savingsBps) / 100}% less USDC-value capital than the full-range contribution for the same depth target.`);
  } else {
    console.log("Depth target: under 0.90% spot impact for a 1 USDC exact-input trade.");
    console.log(`Liquidity to add: ${liquidityToAdd.toString()} units`);
    console.log(`Maximum liquidity contribution: ${usdc(liquidityCaps.usdcMax)} USDC and ${usdc(liquidityCaps.tEthMax, 18)} tETH`);
  }
  if (rebalance.direction) {
    console.log(`Rebalance input: ${usdc(rebalance.amountIn, rebalance.direction === "USDC" ? 6 : 18)} ${rebalance.direction}`);
    console.log(`Estimated output: ${usdc(rebalance.expectedOut, rebalance.direction === "USDC" ? 18 : 6)} ${rebalance.direction === "USDC" ? "tETH" : "USDC"}`);
  } else {
    console.log("Rebalance swap: none; spot is already within 0.50% of the fresh quote.");
  }
  console.log(`Protocol seed: ${usdc(seed)} USDC; required for four proposal markets: ${usdc(perProposal * 4n)} USDC`);
  console.log(`Keeper seed top-up before opening: ${usdc(seedDeficit)} USDC`);
  console.log(`Proposal bonds: deployer ${usdc(bondRequirement)} USDC; keeper ${usdc(keeperBondRequirement)} USDC`);
  console.log(`Arc transaction fee reserves: ${usdc(gasReserveUsdc)} USDC deployer and ${usdc(gasReserveUsdc)} USDC keeper`);
  console.log(`Deployer balance: ${usdc(balances.deployerUsdc)} USDC, ${usdc(balances.deployerTEth, 18)} tETH`);
  console.log(`Keeper balance: ${usdc(balances.keeperUsdc)} USDC`);
  console.log(`Total preflight USDC needed from deployer (pool caps + two bonds + fee reserve): ${usdc(usdcRequirement)} USDC`);
  console.log(`Total preflight USDC needed from keeper (seed top-up + bond + fee reserve): ${usdc(seedDeficit + keeperBondRequirement + gasReserveUsdc)} USDC`);
  console.log(`Additional deployer USDC needed: ${usdc(usdcRequirement > balances.deployerUsdc ? usdcRequirement - balances.deployerUsdc : 0n)} USDC`);
  console.log(`Additional keeper USDC needed: ${usdc(seedDeficit + keeperBondRequirement + gasReserveUsdc > balances.keeperUsdc ? seedDeficit + keeperBondRequirement + gasReserveUsdc - balances.keeperUsdc : 0n)} USDC`);
  console.log(`Total preflight tETH needed from deployer: ${usdc(tEthRequirement, 18)} tETH`);
}

await assertArcTestnet();

const roundCount = await publicClient.readContract({
  address: contracts.quantumRound,
  abi: roundAbi,
  functionName: "roundCount",
});
if (roundCount > 0n) {
  const previousRound = await publicClient.readContract({
    address: contracts.quantumRound,
    abi: roundAbi,
    functionName: "rounds",
    args: [roundCount],
  });
  if (!previousRound[10]) throw new Error(`Round ${roundCount} is not settled; refusing to open another.`);
}

const [bond, seed, perProposal, coinbase, pool, deployerUsdc, deployerTEth, keeperUsdc, deployerAgent, keeperAgent] =
  await Promise.all([
    publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "DEFAULT_BOND" }),
    publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
    publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "initialLiquidityPerProposal" }),
    fetchCoinbasePrice(),
    readPoolState(),
    publicClient.readContract({ address: contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [deployerAddress] }),
    publicClient.readContract({ address: contracts.testAsset, abi: erc20Abi, functionName: "balanceOf", args: [deployerAddress] }),
    publicClient.readContract({ address: contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [keeperAddress] }),
    publicClient.readContract({ address: contracts.proposerRegistry, abi: registryAbi, functionName: "agents", args: [deployerAddress] }),
    publicClient.readContract({ address: contracts.proposerRegistry, abi: registryAbi, functionName: "agents", args: [keeperAddress] }),
  ]);

const keeperRole = await publicClient.readContract({
  address: contracts.quantumRound,
  abi: roundAbi,
  functionName: "KEEPER_ROLE",
});
const [keeperAuthorized, callbackCode] = await Promise.all([
  publicClient.readContract({
    address: contracts.quantumRound,
    abi: roundAbi,
    functionName: "hasRole",
    args: [keeperRole, keeperAddress],
  }),
  publicClient.getBytecode({ address: callbackAddress }),
]);
if (!keeperAuthorized) throw new Error("The configured keeper does not have KEEPER_ROLE on QuantumRound.");
if (!callbackCode || callbackCode === "0x") throw new Error("The configured v4 callback has no code.");

const horizon = BigInt(Number(process.env.DEMO_EVALUATION_WINDOW_SECONDS ?? 300));
if (horizon < 60n || horizon > 86_400n) throw new Error("Evaluation window must be between 60 and 86400 seconds.");

const sqrtAtOracle = sqrt((pool.sqrtPriceX96 * pool.sqrtPriceX96 * pool.spotPrice) / coinbase.priceUsdc);
const requiredLiquidity = [
  liquidityForImpact(pool.sqrtPriceX96, 90n),
  liquidityForImpact(sqrtAtOracle, 90n),
].reduce((maximum, candidate) => candidate > maximum ? candidate : maximum);
const depthLiquidityToAdd = requiredLiquidity > pool.liquidity ? requiredLiquidity - pool.liquidity : 0n;
const liquidityToAdd = testMode ? 0n : depthLiquidityToAdd;
const liquidityCaps = liquidityAmounts(liquidityToAdd, pool.sqrtPriceX96);
const fullRangeCaps = liquidityAmounts(depthLiquidityToAdd, sqrtAtOracle);
const concentratedRange = concentratedRangeAtOracle(sqrtAtOracle);
const concentratedCaps = liquidityAmountsInRange(
  depthLiquidityToAdd,
  sqrtAtOracle,
  concentratedRange.sqrtLower,
  concentratedRange.sqrtUpper,
);
const rebalance = rebalancePlan(
  pool.sqrtPriceX96,
  pool.spotPrice,
  coinbase.priceUsdc,
  testMode ? pool.liquidity : requiredLiquidity,
);
const seedDeficit = perProposal * 4n > seed ? perProposal * 4n - seed : 0n;
const balances = { deployerUsdc, deployerTEth, keeperUsdc };

printPlan({
  quote: coinbase.quote,
  oraclePrice: coinbase.priceUsdc,
  pool,
  liquidityToAdd,
  liquidityCaps,
  fullRangeCaps,
  concentratedCaps,
  rebalance,
  seed,
  seedDeficit,
  perProposal,
  bond,
  balances,
});

if (!deployerAgent[2] || deployerAgent[1].toLowerCase() !== deployerAddress.toLowerCase()) {
  throw new Error("The configured deployer is not an active proposer in ProposerRegistry.");
}
if (!keeperAgent[2] || keeperAgent[1].toLowerCase() !== keeperAddress.toLowerCase()) {
  throw new Error("The configured keeper is not an active proposer in ProposerRegistry.");
}
const deployerUsdcRequirement = liquidityCaps.usdcMax
  + (rebalance.direction === "USDC" ? rebalance.amountIn : 0n)
  + bond * 2n
  + gasReserveUsdc;
const keeperUsdcRequirement = seedDeficit + bond + gasReserveUsdc;
const blockers = [];
if (deployerUsdc < deployerUsdcRequirement) blockers.push("Deployer USDC balance is below the printed pool plan, two bonds, and fee reserve.");
if (deployerTEth < liquidityCaps.tEthMax + (rebalance.direction === "tETH" ? rebalance.amountIn : 0n)) {
  blockers.push("Deployer tETH balance is below the printed pool plan.");
}
if (keeperUsdc < keeperUsdcRequirement) blockers.push("Keeper USDC balance is below the seed top-up, bond, and fee reserve.");
if (blockers.length > 0) {
  throw new Error(`Preflight blocked:\n- ${blockers.join("\n- ")}`);
}

if (!execute) {
  console.log("Read-only preflight complete. Review the pool amounts above, then rerun with --execute to send transactions.");
  process.exit(0);
}

const executionPlan = testMode
  ? `The script will rebalance the existing pool, open a ${tradingMinutes}-minute test round, and create three proposals without adding deep liquidity.`
  : `The script will add the printed full-range liquidity, rebalance the pool, open a ${tradingMinutes}-minute round, and create three proposals.`;
await confirm(executionPlan, "EXECUTE DEMO ROUND");

const deployer = accountFor(process.env.DEPLOYER_PK, deployerAddress, "deployer");
const keeper = accountFor(process.env.KEEPER_PK, keeperAddress, "keeper");
const deployerClient = walletClientFor(deployer);
const keeperClient = walletClientFor(keeper);
const callbackOwner = await publicClient.readContract({
  address: callbackAddress,
  abi: callbackAbi,
  functionName: "owner",
});
if (callbackOwner.toLowerCase() !== deployer.address.toLowerCase()) {
  throw new Error("The deployer does not own the configured v4 callback.");
}

if (seedDeficit > 0n) {
  await ensureAllowance(
    "Keeper protocol-seed top-up",
    keeperClient,
    contracts.usdc,
    keeper.address,
    contracts.quantumRound,
    seedDeficit,
    usdcAbi,
  );
  await sendContract(
    `Keeper adds ${usdc(seedDeficit)} USDC protocol seed`,
    keeperClient,
    contracts.quantumRound,
    roundAbi,
    "addProtocolLiquiditySeed",
    [seedDeficit],
  );
}

if (liquidityToAdd > 0n) {
  await ensureAllowance(
    "USDC to v4 callback",
    deployerClient,
    contracts.usdc,
    deployer.address,
    callbackAddress,
    liquidityCaps.usdcMax,
    usdcAbi,
  );
  await ensureAllowance(
    "tETH to v4 callback",
    deployerClient,
    contracts.testAsset,
    deployer.address,
    callbackAddress,
    liquidityCaps.tEthMax,
    erc20Abi,
  );
  const addPayload = encodeAbiParameters(
    [
      { type: "uint8" },
      poolKeyType,
      { type: "address" },
      { type: "int24" },
      { type: "int24" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [0, poolKey, deployer.address, minTick, maxTick, liquidityToAdd, liquidityCaps.usdcMax, liquidityCaps.tEthMax],
  );
  const addSimulation = await callCallback(deployer.address, addPayload);
  const [deltaUsdc, deltaTEth] = decodeAbiParameters(
    [{ type: "int128" }, { type: "int128" }],
    addSimulation,
  );
  if (deltaUsdc >= 0n || deltaTEth >= 0n || -deltaUsdc > liquidityCaps.usdcMax || -deltaTEth > liquidityCaps.tEthMax) {
    throw new Error(`Liquidity simulation exceeded printed caps: ${deltaUsdc}, ${deltaTEth}.`);
  }
  await sendCallback("Add full-range USDC/tETH liquidity", deployerClient, addPayload);
}

let postLiquidityPool = await readPoolState();
const actualRebalance = rebalancePlan(
  postLiquidityPool.sqrtPriceX96,
  postLiquidityPool.spotPrice,
  coinbase.priceUsdc,
  postLiquidityPool.liquidity,
);
if (actualRebalance.direction) {
  const inputToken = actualRebalance.direction === "USDC" ? contracts.usdc : contracts.testAsset;
  const inputAbi = actualRebalance.direction === "USDC" ? usdcAbi : erc20Abi;
  const inputBalance = await publicClient.readContract({
    address: inputToken,
    abi: inputAbi,
    functionName: "balanceOf",
    args: [deployer.address],
  });
  if (inputBalance < actualRebalance.amountIn) {
    throw new Error(`Rebalance now requires ${usdc(actualRebalance.amountIn, actualRebalance.direction === "USDC" ? 6 : 18)} ${actualRebalance.direction}; balance is insufficient.`);
  }
  await confirm(
    `Pool rebalance now requires ${usdc(actualRebalance.amountIn, actualRebalance.direction === "USDC" ? 6 : 18)} ${actualRebalance.direction} in; estimated output is ${usdc(actualRebalance.expectedOut, actualRebalance.direction === "USDC" ? 18 : 6)}.`,
    "CONFIRM POOL REBALANCE",
  );
  await ensureAllowance(
    `${actualRebalance.direction} to v4 callback`,
    deployerClient,
    inputToken,
    deployer.address,
    callbackAddress,
    actualRebalance.amountIn,
    inputAbi,
  );
  const zeroForOne = actualRebalance.direction === "USDC";
  const sqrtLimit = zeroForOne ? actualRebalance.sqrtTarget - 1n : actualRebalance.sqrtTarget + 1n;
  const swapPayload = encodeAbiParameters(
    [
      { type: "uint8" },
      poolKeyType,
      { type: "address" },
      { type: "bool" },
      { type: "int256" },
      { type: "uint160" },
    ],
    [1, poolKey, deployer.address, zeroForOne, actualRebalance.amountIn, sqrtLimit],
  );
  const simulatedSwap = await callCallback(deployer.address, swapPayload);
  const [delta0, delta1] = decodeAbiParameters(
    [{ type: "int128" }, { type: "int128" }],
    simulatedSwap,
  );
  if ((zeroForOne && (delta0 >= 0n || delta1 <= 0n)) || (!zeroForOne && (delta1 >= 0n || delta0 <= 0n))) {
    throw new Error(`Pool rebalance simulation returned unexpected deltas: ${delta0}, ${delta1}.`);
  }
  await sendCallback("Rebalance USDC/tETH pool", deployerClient, swapPayload);
  postLiquidityPool = await readPoolState();
}

const finalDeviation = (postLiquidityPool.spotPrice > coinbase.priceUsdc
  ? postLiquidityPool.spotPrice - coinbase.priceUsdc
  : coinbase.priceUsdc - postLiquidityPool.spotPrice) * 10_000n / coinbase.priceUsdc;
if (finalDeviation > 50n) {
  throw new Error(`Pool remains ${finalDeviation} bps from Coinbase after rebalancing; round not opened.`);
}
const finalLiquidityRequirement = liquidityForImpact(postLiquidityPool.sqrtPriceX96, 90n);
if (!testMode && postLiquidityPool.liquidity < finalLiquidityRequirement) {
  throw new Error("The pool's active liquidity does not meet the sub-1% 1-USDC trade-depth target; round not opened.");
}

const bondRequirement = bond * 2n;
const keeperBondRequirement = bond;
await ensureAllowance(
  "Deployer bonds to proposer registry",
  deployerClient,
  contracts.usdc,
  deployer.address,
  contracts.proposerRegistry,
  bondRequirement,
  usdcAbi,
);
await ensureAllowance(
  "Keeper bond to proposer registry",
  keeperClient,
  contracts.usdc,
  keeper.address,
  contracts.proposerRegistry,
  keeperBondRequirement,
  usdcAbi,
);

const block = await publicClient.getBlock({ blockTag: "latest" });
const tradingEnd = block.timestamp + BigInt(tradingMinutes * 60);
const expectedRoundId = roundCount + 1n;
await sendContract("Open demo round", keeperClient, contracts.quantumRound, roundAbi, "openRound", [
  tradingEnd,
  horizon,
  950_000_000_000_000_000n,
  1_050_000_000_000_000_000n,
  60,
]);
const proposals = [
  {
    client: deployerClient,
    label: "Proposal 1 (deployer, 7.5% tETH)",
    bps: 750,
    rationale: "A conservative 7.5% tETH allocation limits drawdown exposure while preserving a measured opportunity to benefit from ETH appreciation; keep the remainder in USDC.",
  },
  {
    client: keeperClient,
    label: "Proposal 2 (keeper, 25% tETH)",
    bps: 2_500,
    rationale: "A diversified 25% tETH allocation balances moderate ETH upside participation against a 75% USDC reserve for stability and liquidity.",
  },
  {
    client: deployerClient,
    label: "Proposal 3 (deployer, 50% tETH)",
    bps: 5_000,
    rationale: "A growth-oriented 50% tETH allocation accepts higher volatility in exchange for stronger upside exposure, with half of the vault retained in USDC.",
  },
];
for (const proposal of proposals) {
  await sendContract(
    proposal.label,
    proposal.client,
    contracts.quantumRound,
    roundAbi,
    "propose",
    [expectedRoundId, { tEthBps: proposal.bps }, proposal.rationale],
  );
}

startOracleWatcher();
console.log(`Demo round ${expectedRoundId} opened. Trading ends at ${tradingEnd}; the oracle watcher is running.`);
