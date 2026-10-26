"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatUnits } from "viem";
import { useDemo } from "../demo-context";
import ThemeToggle from "../theme-toggle";
import { useWallet } from "../hooks/useWallet";
import { addresses, erc20Abi, publicClient } from "../lib/contracts";
import { explorerAddress } from "../lib/explorer";

const contractLinks = [
  ["QuantumRound", addresses.quantumRound],
  ["WaveV4ProposalMarket", addresses.market],
  ["WaveHook", addresses.waveHook],
  ["ProposalTokens", addresses.proposalTokens],
  ["Resolver", addresses.resolver],
  ["WavefundVault", addresses.vault],
] as const;

const navigation = [
  { label: "Home", href: "/demo" },
  { label: "Markets", href: "/demo/markets" },
  { label: "Vault", href: "/demo/vault" },
  { label: "Portfolio", href: "/demo/portfolio" },
  { label: "Agents", href: "/demo/agents" },
  { label: "How it works", href: "/demo/how-it-works" },
];

const pageTitles: Record<string, string> = {
  "/demo": "Protocol overview",
  "/demo/markets": "Decision markets",
  "/demo/vault": "Wavefund vault",
  "/demo/portfolio": "Portfolio",
  "/demo/agents": "Agents",
  "/demo/how-it-works": "How it works",
};

export default function DemoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { demo, mode, setMode, connectDemoAccount } = useDemo();
  const wallet = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState("");

  useEffect(() => {
    document.title = `${pageTitles[pathname] ?? "Demo"} — Wavefund`;
  }, [pathname]);

  useEffect(() => {
    const address = wallet.address;
    if (!address) {
      setUsdcBalance(null);
      setBalanceError("");
      return;
    }

    let active = true;
    const refreshBalance = () => {
      publicClient.readContract({
        address: addresses.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }).then((balance) => {
        if (!active) return;
        setUsdcBalance(balance);
        setBalanceError("");
      }).catch((error: unknown) => {
        if (!active) return;
        setBalanceError(`Could not read ERC-20 USDC balance: ${error instanceof Error ? error.message : "Unknown RPC error."}`);
      });
    };

    refreshBalance();
    const timer = window.setInterval(refreshBalance, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [wallet.address]);

  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
    : "";
  const balanceText = usdcBalance === null
    ? "USDC…"
    : `${Number(formatUnits(usdcBalance, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;

  return (
    <div className="demo-app">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Wavefund landing page">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>wavefund</span>
        </Link>
        <button
          className="mobile-menu-trigger"
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileMenuOpen ? "×" : "☰"}</span>
        </button>
        <nav className={`main-nav ${mobileMenuOpen ? "is-open" : ""}`} aria-label="Main navigation">
          {navigation.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={pathname === href ? "active" : undefined}
              onClick={() => setMobileMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <span className="network-pill"><span className="network-dot" /> Arc testnet · {mode}</span>
          <ThemeToggle />
          <button
            className="button button-dark"
            type="button"
            onClick={() => setMode(mode === "mock" ? "live" : "mock")}
          >
            {mode === "mock" ? "Use on-chain data" : "Use mock data"}
          </button>
          {mode === "mock" ? (
            <button className="button button-dark button-connect" type="button" onClick={connectDemoAccount}>
              {demo.demoAccountConnected ? "Demo account connected" : "Connect demo account"}
            </button>
          ) : (
            <button
              className="button button-dark button-connect"
              type="button"
              disabled={wallet.connecting}
              onClick={() => {
                setWalletError("");
                const connectOrSwitch = wallet.address && wallet.chainId !== 5_042_002
                  ? wallet.switchToArc()
                  : wallet.connect();
                connectOrSwitch.catch((error: unknown) => {
                  setWalletError(error instanceof Error ? error.message : "The wallet returned an unknown error.");
                });
              }}
              title={wallet.address ? `${wallet.address} · ${balanceText}` : undefined}
            >
              {wallet.address && wallet.chainId !== 5_042_002
                ? `${shortAddress} · Switch to Arc`
                : wallet.address
                  ? `${shortAddress} · ${balanceText}`
                  : wallet.connecting
                    ? "Connecting…"
                    : "Connect wallet"}
            </button>
          )}
        </div>
      </header>
      {mode === "live" && (walletError || wallet.error || balanceError || (wallet.address && wallet.chainId !== 5_042_002)) && (
        <div className="storage-warning page-shell" role="status">
          {walletError || wallet.error || balanceError || "Switch your wallet to Arc Testnet to transact."}
        </div>
      )}
      {children}
      <footer className="demo-shell-footer page-shell">
        <Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>wavefund</span></Link>
        <span>{mode === "mock" ? "Local simulation · No real funds are managed" : "Live Arc Testnet data · transactions require wallet approval"}</span>
        {mode === "live" && (
          <details className="footer-contracts">
            <summary>Contracts · Phase B · verified on Arc Explorer</summary>
            {contractLinks.map(([name, address]) => (
              <a key={name} href={explorerAddress(address)} target="_blank" rel="noreferrer">{name} {address.slice(0, 8)}…{address.slice(-6)} ↗</a>
            ))}
          </details>
        )}
      </footer>
    </div>
  );
}
