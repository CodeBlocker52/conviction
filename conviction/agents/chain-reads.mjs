export async function readProposalTokenAddresses(client, tokens, abi, roundId, proposalId) {
  const [credit, long, short] = await client.multicall({
    contracts: ["creditToken", "longToken", "shortToken"].map((functionName) => ({
      address: tokens, abi, functionName, args: [roundId, BigInt(proposalId)],
    })),
    allowFailure: false,
  });
  return { credit, long, short };
}

export async function readTokenHoldings(client, addresses, abi, account) {
  const [credit, long, short] = await client.multicall({
    contracts: [addresses.credit, addresses.long, addresses.short].map((address) => ({
      address, abi, functionName: "balanceOf", args: [account],
    })),
    allowFailure: false,
  });
  return { credit, long, short };
}
