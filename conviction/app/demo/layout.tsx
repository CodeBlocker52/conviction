import type { ReactNode } from "react";
import { DemoProvider } from "../demo-context";
import { WalletProvider } from "../hooks/useWallet";
import DemoShell from "./demo-shell";

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <DemoProvider>
        <DemoShell>{children}</DemoShell>
      </DemoProvider>
    </WalletProvider>
  );
}
