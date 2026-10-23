"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createWalletClient, custom, isAddress, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { arcTestnet } from "../lib/contracts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Wallet request failed.";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No browser wallet found. Install a wallet with Arc Testnet support.");

    setConnecting(true);
    setError("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || !isAddress(accounts[0])) {
        throw new Error("The wallet did not return an account.");
      }

      const chainIdHex = await provider.request({ method: "eth_chainId" });
      if (typeof chainIdHex !== "string") throw new Error("The wallet returned an invalid chain ID.");
      let connectedChainId = Number.parseInt(chainIdHex, 16);

      if (connectedChainId !== arcTestnet.id) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${arcTestnet.id.toString(16)}` }],
          });
        } catch (switchError) {
          const code = switchError && typeof switchError === "object" && "code" in switchError
            ? switchError.code
            : undefined;
          if (code !== 4902) throw switchError;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: `0x${arcTestnet.id.toString(16)}`,
              chainName: arcTestnet.name,
              nativeCurrency: arcTestnet.nativeCurrency,
              rpcUrls: [...arcTestnet.rpcUrls.default.http],
              blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
            }],
          });
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${arcTestnet.id.toString(16)}` }],
          });
        }
        connectedChainId = arcTestnet.id;
      }

      const nextAddress = accounts[0];
      setAddress(nextAddress);
      setChainId(connectedChainId);
      setWalletClient(createWalletClient({
        account: nextAddress,
        chain: arcTestnet,
        transport: custom(provider),
      }));
    } catch (connectError) {
      const message = errorMessage(connectError);
      setError(message);
      throw connectError;
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchToArc = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No browser wallet found.");
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${arcTestnet.id.toString(16)}` }],
      });
      setChainId(arcTestnet.id);
      setError("");
    } catch (switchError) {
      const code = switchError && typeof switchError === "object" && "code" in switchError
        ? switchError.code
        : undefined;
      if (code !== 4902) {
        const message = errorMessage(switchError);
        setError(message);
        throw switchError;
      }
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: `0x${arcTestnet.id.toString(16)}`,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: [...arcTestnet.rpcUrls.default.http],
          blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
        }],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${arcTestnet.id.toString(16)}` }],
      });
      setChainId(arcTestnet.id);
      setError("");
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setWalletClient(null);
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      if (!Array.isArray(accounts) || !isAddress(accounts[0])) {
        disconnect();
        return;
      }
      const nextAddress = accounts[0];
      setAddress(nextAddress);
      setWalletClient(createWalletClient({
        account: nextAddress,
        chain: arcTestnet,
        transport: custom(provider),
      }));
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
  }, [disconnect]);

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
