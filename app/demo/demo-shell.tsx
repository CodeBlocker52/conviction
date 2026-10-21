"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDemo } from "../demo-context";
import ThemeToggle from "../theme-toggle";

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
  const { demo, connectDemoAccount } = useDemo();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
          <span className="network-pill"><span className="network-dot" /> Arc testnet · demo</span>
          <ThemeToggle />
          <button className="button button-dark button-connect" type="button" onClick={connectDemoAccount}>
            {demo.demoAccountConnected ? "Demo account connected" : "Connect demo account"}
          </button>
        </div>
      </header>
      {children}
      <footer className="demo-shell-footer page-shell">
        <Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>wavefund</span></Link>
        <span>Local simulation · No real funds are managed</span>
      </footer>
    </div>
  );
}
