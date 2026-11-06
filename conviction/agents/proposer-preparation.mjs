export function proposerReadContracts({ agents, round, registry, usdc, roundAbi, registryAbi, usdcAbi }) {
  return [
    { address: round, abi: roundAbi, functionName: "DEFAULT_BOND" },
    ...agents.flatMap((agent) => [
      { address: registry, abi: registryAbi, functionName: "agents", args: [agent.address] },
      { address: usdc, abi: usdcAbi, functionName: "allowance", args: [agent.address, registry] },
    ]),
  ];
}

export async function readProposerReadiness({ client, agents, ...contracts }) {
  const results = await client.multicall({
    contracts: proposerReadContracts({ agents, ...contracts }),
    allowFailure: false,
  });
  const bond = results[0];
  return new Map(agents.map((agent, index) => [agent.id, {
    bond,
    registryInfo: results[1 + index * 2],
    allowance: results[2 + index * 2],
  }]));
}

export async function prepareProposer({ agent, readiness, targetAllowance, registry, usdc, submit, assertIdle, assertBond }) {
  const { bond, registryInfo, allowance } = readiness;
  assertBond(bond);
  if (targetAllowance < bond) throw new Error("Preparation allowance must cover at least one proposer bond.");
  if (registryInfo[1] === "0x0000000000000000000000000000000000000000") {
    await assertIdle();
    await submit(agent, { address: registry, signature: "registerAgent(string)", args: [agent.name], label: "register proposer" });
  } else if (!registryInfo[2]) {
    throw new Error(`${agent.name} is registered but deactivated.`);
  }
  if (allowance < targetAllowance) {
    if (allowance > 0n) {
      await assertIdle();
      await submit(agent, { address: usdc, signature: "approve(address,uint256)", args: [registry, 0n], label: "reset bond allowance" });
    }
    await assertIdle();
    await submit(agent, { address: usdc, signature: "approve(address,uint256)", args: [registry, targetAllowance], label: "prepare bond allowance" });
  }
}
