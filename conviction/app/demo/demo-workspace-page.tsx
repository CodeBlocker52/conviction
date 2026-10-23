"use client";

import { useEffect, useState, type ReactNode } from "react";
import DemoWorkspace, { type DemoWorkspaceView } from "../demo-workspace";

const pageCopy: Record<DemoWorkspaceView, { eyebrow: string; title: string; description: string }> = {
  markets: {
    eyebrow: "DECISION MARKETS",
    title: "Forecast every proposal.",
    description: "Compare the market-implied return for each allocation, claim proposal credits, and trade the outcome you believe in.",
  },
  portfolio: {
    eyebrow: "YOUR ACCOUNT",
    title: "Portfolio & positions.",
    description: "Follow your simulated account balances, independently claimed credits, and open or settled positions.",
  },
  vault: {
    eyebrow: "SHARED USDC FUND",
    title: "The Wavefund vault.",
    description: "Review the fund's allocation and manage simulated vault deposits, withdrawals, and shared market liquidity.",
  },
};

export default function DemoWorkspacePage({
  view,
  children,
  showHeading = true,
}: {
  view: DemoWorkspaceView;
  children?: ReactNode;
  showHeading?: boolean;
}) {
  const [toast, setToast] = useState("");
  const copy = pageCopy[view];

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  return (
    <main className="demo-page page-shell">
      {showHeading && <header className="demo-page-heading demo-page-heading-primary">
        <div><span className="eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1></div>
        <p>{copy.description}</p>
      </header>}
      {children}
      <DemoWorkspace view={view} notify={setToast} />
      {toast && <div className="toast-message" role="status"><span className="toast-check">✓</span>{toast}<button type="button" aria-label="Dismiss notification" onClick={() => setToast("")}>×</button></div>}
    </main>
  );
}
