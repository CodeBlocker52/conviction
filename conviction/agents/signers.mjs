import { randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  formatUnits,
  parseAbi,
  parseUnits,
} from "viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { agentSlug, circleWalletIdEnvKey, localPrivateKeyEnvKey } from "./config.mjs";
import { deployment, publicClient, rpcUrl, chain } from "../contracts/script/demo-round-common.mjs";
import { assertGasWithinCap, PER_AGENT_GAS_CAP_WEI } from "./safety.mjs";
import { readDailyGasReservations } from "./logging.mjs";

function requiredEnv(env, key) {
  const value = env[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Set ${key} in the private .env file.`);
  return value;
}

function nativeFeeToWei(value) {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("Circle did not return a valid estimated native network fee.");
  }
  return parseUnits(value, 18);
}

function serializeAbiParameter(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeAbiParameter);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeAbiParameter(item)]));
  }
  return value;
}

export class CircleAgentSigner {
  constructor({
    agent,
    walletId,
    client,
    gasCapWei = PER_AGENT_GAS_CAP_WEI,
    spentGasWei = readDailyGasReservations(agent.id),
    logEvent = () => {},
    waitForReceipt = (hash) => publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }),
  }) {
    this.agent = agent;
    this.walletId = walletId;
    this.client = client;
    this.gasCapWei = gasCapWei;
    this.spentGasWei = spentGasWei;
    this.logEvent = logEvent;
    this.waitForReceipt = waitForReceipt;
    this.queue = Promise.resolve();
  }

  executeContractCall(call) {
    const result = this.queue.then(() => this.performContractCall(call));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async performContractCall({ address, signature, args, label }) {
    const abiParameters = serializeAbiParameter(args);
    let estimate;
    try {
      estimate = await this.client.estimateContractExecutionFee({
        abiFunctionSignature: signature,
        abiParameters,
        contractAddress: address,
        source: { walletId: this.walletId },
      });
    } catch {
      throw new Error(`Circle could not estimate the fee for ${label}; no transaction was submitted.`);
    }
    const mediumFee = estimate.data?.medium;
    const estimatedGasWei = nativeFeeToWei(mediumFee?.networkFee);
    assertGasWithinCap(this.spentGasWei, estimatedGasWei, this.gasCapWei);
    this.spentGasWei += estimatedGasWei;
    const idempotencyKey = randomUUID();
    this.logEvent({
      type: "transaction_attempt",
      agentId: this.agent.id,
      label,
      reservationId: idempotencyKey,
      estimatedGasWei: estimatedGasWei.toString(),
    });

    let created;
    try {
      created = await this.client.createContractExecutionTransaction({
        walletId: this.walletId,
        contractAddress: address,
        abiFunctionSignature: signature,
        abiParameters,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey,
        refId: `${agentSlug(this.agent.name)}-${label.slice(0, 60)}`,
      });
    } catch (error) {
      // An explicit 4xx rejection means nothing was broadcast, so the reservation is released.
      // Anything else (timeouts, 5xx) may have created a transaction, so the reservation stays.
      const status = error?.response?.status ?? error?.status;
      if (Number.isInteger(status) && status >= 400 && status < 500) {
        this.spentGasWei -= estimatedGasWei;
        this.logEvent({ type: "transaction_released", agentId: this.agent.id, label, reservationId: idempotencyKey });
      }
      throw new Error(`Circle transaction request for ${label} failed; it was not automatically retried.`);
    }
    const transactionId = created.data?.id ?? created.data?.transaction?.id;
    if (typeof transactionId !== "string" || !transactionId) {
      throw new Error(`Circle returned no transaction ID for ${label}; inspect Circle before retrying.`);
    }
    this.logEvent({
      type: "transaction_submitted",
      agentId: this.agent.id,
      label,
      transactionId,
      idempotencyKey,
    });

    let transaction;
    try {
      transaction = await this.client.getTransaction({
        id: transactionId,
        waitForTxHash: true,
        pollingInterval: 2_000,
      });
    } catch {
      throw new Error(`Circle transaction ${transactionId} has an unknown outcome; inspect Circle before retrying.`);
    }
    const hash = transaction.data?.transaction?.txHash;
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error(`Circle transaction ${transactionId} returned no valid transaction hash.`);
    }

    const receipt = await this.waitForReceipt(hash);
    if (receipt.effectiveGasPrice === undefined) {
      throw new Error(`${label} receipt did not include an effective gas price.`);
    }
    const actualGasWei = receipt.gasUsed * receipt.effectiveGasPrice;
    // The estimate was only a pending reservation; the confirmed fee replaces it.
    this.spentGasWei += actualGasWei - estimatedGasWei;
    this.logEvent({
      type: "transaction",
      agentId: this.agent.id,
      label,
      hash,
      reservationId: idempotencyKey,
      status: receipt.status,
      estimatedGasWei: estimatedGasWei.toString(),
      actualGasWei: actualGasWei.toString(),
      gasUsdc: formatUnits(actualGasWei, 18),
    });
    if (receipt.status !== "success") throw new Error(`${label} reverted on-chain: ${hash}`);
    return { hash, estimatedGasWei, actualGasWei };
  }
}

export class LocalAgentSigner {
  constructor({
    agent,
    account,
    gasCapWei = PER_AGENT_GAS_CAP_WEI,
    spentGasWei = readDailyGasReservations(agent.id),
    logEvent,
  }) {
    this.agent = agent;
    this.account = account;
    this.gasCapWei = gasCapWei;
    this.spentGasWei = spentGasWei;
    this.logEvent = logEvent;
    this.walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    this.queue = Promise.resolve();
  }

  executeContractCall(call) {
    const result = this.queue.then(() => this.performContractCall(call));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async performContractCall({ address, signature, args, label }) {
    const abi = parseAbi([`function ${signature}`]);
    const functionName = signature.slice(0, signature.indexOf("("));
    const data = encodeFunctionData({ abi, functionName, args });
    const [estimatedGas, gasPrice] = await Promise.all([
      publicClient.estimateGas({ account: this.account, to: address, data }),
      publicClient.getGasPrice(),
    ]);
    const estimatedGasWei = estimatedGas * gasPrice;
    assertGasWithinCap(this.spentGasWei, estimatedGasWei, this.gasCapWei);
    this.spentGasWei += estimatedGasWei;
    const reservationId = randomUUID();
    this.logEvent({
      type: "transaction_attempt",
      agentId: this.agent.id,
      label,
      reservationId,
      estimatedGasWei: estimatedGasWei.toString(),
    });
    const hash = await this.walletClient.sendTransaction({ account: this.account, to: address, data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.effectiveGasPrice === undefined) {
      throw new Error(`${label} receipt did not include an effective gas price.`);
    }
    const actualGasWei = receipt.gasUsed * receipt.effectiveGasPrice;
    // The estimate was only a pending reservation; the confirmed fee replaces it.
    this.spentGasWei += actualGasWei - estimatedGasWei;
    this.logEvent({
      type: "transaction",
      agentId: this.agent.id,
      label,
      hash,
      reservationId,
      status: receipt.status,
      estimatedGasWei: estimatedGasWei.toString(),
      actualGasWei: actualGasWei.toString(),
      gasUsdc: formatUnits(actualGasWei, 18),
    });
    if (receipt.status !== "success") throw new Error(`${label} reverted on-chain: ${hash}`);
    return { hash, estimatedGasWei, actualGasWei };
  }
}

export function createAgentSigner(agent, env = process.env, logEvent = () => {}) {
  const backend = env.AGENT_SIGNER_BACKEND ?? "circle";
  if (backend === "circle") {
    if (!agent.address) throw new Error(`Agent ${agent.name} needs a Circle wallet address from agents:setup.`);
    const apiKey = requiredEnv(env, "CIRCLE_API_KEY");
    const entitySecret = requiredEnv(env, "CIRCLE_ENTITY_SECRET");
    const walletId = requiredEnv(env, circleWalletIdEnvKey(agent));
    const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
    return new CircleAgentSigner({ agent, walletId, client, logEvent });
  }
  if (backend === "local") {
    if (env.AGENT_LOCAL_SIGNER_APPROVED !== "true") {
      throw new Error("Local agent signing is disabled until AGENT_LOCAL_SIGNER_APPROVED=true is explicitly approved.");
    }
    if (!agent.address) throw new Error(`Agent ${agent.name} needs a configured public address.`);
    const privateKey = requiredEnv(env, localPrivateKeyEnvKey(agent));
    const account = privateKeyToAccount(privateKey);
    if (account.address.toLowerCase() !== agent.address.toLowerCase()) {
      throw new Error(`Local key for ${agent.name} does not match agents.json.`);
    }
    if ([deployment.admin, deployment.keeper].some((address_) => address_.toLowerCase() === account.address.toLowerCase())) {
      throw new Error("Deployer and keeper keys cannot be used as agent signers.");
    }
    return new LocalAgentSigner({ agent, account, logEvent });
  }
  throw new Error(`Unsupported agent signer backend: ${backend}.`);
}
