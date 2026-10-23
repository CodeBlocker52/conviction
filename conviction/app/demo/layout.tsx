import type { ReactNode } from "react";
import { DemoProvider } from "../demo-context";
import DemoShell from "./demo-shell";

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <DemoShell>{children}</DemoShell>
    </DemoProvider>
  );
}
