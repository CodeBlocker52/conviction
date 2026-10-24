"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  isAddress,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { arcTestnet } from "../lib/contracts";

type BrowserProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type Eip6963Provider = {
  info: { uuid: string; name: string; rdns: string };
  provider: BrowserProvider;
};

declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}

type WalletContextValue = {
  address: Address | null;
  chainId: number | null;
  walletClient: WalletClient | null;
  connecting: boolean;
  error: string;
  connect: () => Promise<void>;
  switchToArc: () => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const ARC_CHAIN_ID_HEX = `0x${arcTestnet.id.toString(16)}`;

function providerErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "number" ? code : typeof code === "string" ? Number(code) : undefined;
}

function errorMessage(error: unknown, action: "connect" | "switch") {
  const code = providerErrorCode(error);
  if (code === 4001) {
    return action === "connect"
      ? "You rejected the wallet connection request (error 4001)."
      : "You rejected switching to Arc Testnet (error 4001).";
  }
  if (code === -32002) {
    return "A wallet request is already pending (error -32002). Complete or dismiss it in your wallet, then try again.";
  }
  if (code === 4902) {
    return "Arc Testnet could not be added to this wallet (error 4902).";
  }
  if (error instanceof Error && error.message) return error.message;
  return "The wallet returned an unknown error.";
}

function selectProvider(providers: Eip6963Provider[]) {
  const metaMask = providers.find(({ info }) =>
    info.rdns.toLowerCase() === "io.metamask" || info.name.toLowerCase().includes("metamask"),
  );
  return (metaMask ?? providers[0])?.provider ?? null;
}

function walletClientFor(provider: BrowserProvider, account: Address) {
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: custom(provider),
  });
}

async function switchProviderToArc(provider: BrowserProvider) {
  const currentChain = await provider.request({ method: "eth_chainId" });
  if (typeof currentChain !== "string") throw new Error("The wallet returned an invalid chain ID.");

  if (Number.parseInt(currentChain, 16) !== arcTestnet.id) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if (providerErrorCode(switchError) !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: ARC_CHAIN_ID_HEX,
          chainName: "Arc Testnet",
          rpcUrls: ["https://rpc.testnet.arc.io"],
          blockExplorerUrls: ["https://explorer.testnet.arc.io"],
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        }],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID_HEX }],
      });
    }
  }

  const switchedChain = await provider.request({ method: "eth_chainId" });
  if (typeof switchedChain !== "string") throw new Error("The wallet returned an invalid chain ID.");
  const chainId = Number.parseInt(switchedChain, 16);
  if (chainId !== arcTestnet.id) {
    throw new Error(`Wrong network: wallet is on chain ${chainId}; switch to Arc Testnet (${arcTestnet.id}).`);
  }
  return chainId;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const providerRef = useRef<BrowserProvider | null>(null);
  const providerReadyRef = useRef<Promise<void>>(Promise.resolve());
  const announcedProvidersRef = useRef<Eip6963Provider[]>([]);
  const addressRef = useRef<Address | null>(null);

  useEffect(() => {
    let resolveDiscovery: (() => void) | undefined;
    providerReadyRef.current = new Promise<void>((resolve) => {
      resolveDiscovery = resolve;
    });
    let discoveryComplete = false;

    const finishDiscovery = () => {
      if (discoveryComplete) return;
      discoveryComplete = true;
      const announced = selectProvider(announcedProvidersRef.current);
      const selected = announced ?? window.ethereum ?? null;
      providerRef.current = selected;
      setProvider(selected);
      resolveDiscovery?.();
    };
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Provider>).detail;
      if (!detail?.provider || !detail.info?.uuid) return;
      if (!announcedProvidersRef.current.some(({ info }) => info.uuid === detail.info.uuid)) {
        announcedProvidersRef.current = [...announcedProvidersRef.current, detail];
      }

      if (discoveryComplete && !addressRef.current) {
        const preferred = selectProvider(announcedProvidersRef.current);
        if (preferred) {
          providerRef.current = preferred;
          setProvider(preferred);
        }
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const timeout = window.setTimeout(finishDiscovery, 400);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolveDiscovery?.();
    };
  }, []);

  const disconnect = useCallback(() => {
    addressRef.current = null;
    setAddress(null);
    setChainId(null);
    setWalletClient(null);
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      await providerReadyRef.current;
      const selectedProvider = providerRef.current;
      if (!selectedProvider) {
        throw new Error("No wallet found. Install MetaMask or another EIP-1193 browser wallet.");
      }

      const accounts = await selectedProvider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
        throw new Error("The wallet did not authorize an account.");
      }

      let nextChainId: number;
      try {
        nextChainId = await switchProviderToArc(selectedProvider);
      } catch (switchError) {
        throw new Error(errorMessage(switchError, "switch"));
      }

      const nextAddress = accounts[0];
      providerRef.current = selectedProvider;
      addressRef.current = nextAddress;
      setProvider(selectedProvider);
      setAddress(nextAddress);
      setChainId(nextChainId);
      setWalletClient(walletClientFor(selectedProvider, nextAddress));
    } catch (connectError) {
      const message = connectError instanceof Error && connectError.message.startsWith("No wallet found")
        ? connectError.message
        : errorMessage(connectError, "connect");
      setError(message);
      throw new Error(message, { cause: connectError });
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchToArc = useCallback(async () => {
    setError("");
    const selectedProvider = providerRef.current;
    if (!selectedProvider) {
      const message = "No wallet found. Install MetaMask or another EIP-1193 browser wallet.";
      setError(message);
      throw new Error(message);
    }

    try {
      const nextChainId = await switchProviderToArc(selectedProvider);
      setChainId(nextChainId);
    } catch (switchError) {
      const message = errorMessage(switchError, "switch");
      setError(message);
      throw new Error(message, { cause: switchError });
    }
  }, []);

  useEffect(() => {
    if (!provider) return;
    let active = true;

    const restoreAuthorization = async () => {
      const [accounts, chainHex] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      if (!active) return;

      const restoredAddress = Array.isArray(accounts) && typeof accounts[0] === "string" && isAddress(accounts[0])
        ? accounts[0]
        : null;
      const restoredChainId = typeof chainHex === "string" ? Number.parseInt(chainHex, 16) : null;
      addressRef.current = restoredAddress;
      setAddress(restoredAddress);
      setChainId(restoredChainId);
      setWalletClient(restoredAddress ? walletClientFor(provider, restoredAddress) : null);
    };

    void restoreAuthorization().catch((restoreError: unknown) => {
      if (active) setError(`Could not restore the wallet connection: ${errorMessage(restoreError, "connect")}`);
    });

    return () => {
      active = false;
    };
  }, [provider]);

  useEffect(() => {
    if (!provider?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
        disconnect();
        return;
      }
      const nextAddress = accounts[0];
      addressRef.current = nextAddress;
      setAddress(nextAddress);
      setWalletClient(walletClientFor(provider, nextAddress));
      setError("");
    };
    const onChainChanged = (...args: unknown[]) => {
      const nextChainId = args[0];
      setChainId(typeof nextChainId === "string" ? Number.parseInt(nextChainId, 16) : null);
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [disconnect, provider]);

  const value = useMemo(
    () => ({ address, chainId, walletClient, connecting, error, connect, switchToArc, disconnect }),
    [address, chainId, walletClient, connecting, error, connect, switchToArc, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}
