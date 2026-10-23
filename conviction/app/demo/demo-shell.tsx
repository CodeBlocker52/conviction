"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDemo } from "../demo-context";
import ThemeToggle from "../theme-toggle";
import { useWallet } from "../hooks/useWallet";

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

  useEffect(() => {
    document.title = `${pageTitles[pathname] ?? "Demo"} — Wavefund`;
  }, [pathname]);

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
                  setWalletError(error instanceof Error ? error.message : "Could not connect wallet.");
                });
              }}
            >
              {wallet.address && wallet.chainId !== 5_042_002
                ? "Switch to Arc"
                : wallet.address
                  ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                  : wallet.connecting
                    ? "Connecting…"
                    : "Connect wallet"}
            </button>
          )}
        </div>
      </header>
      {mode === "live" && (walletError || wallet.error || (wallet.address && wallet.chainId !== 5_042_002)) && (
        <div className="storage-warning page-shell" role="status">
          {walletError || wallet.error || "Switch your wallet to Arc Testnet to transact."}
        </div>
      )}
      {children}
      <footer className="demo-shell-footer page-shell">
        <Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>wavefund</span></Link>
        <span>{mode === "mock" ? "Local simulation · No real funds are managed" : "Live Arc Testnet data · transactions require wallet approval"}</span>
      </footer>
    </div>
  );
}
