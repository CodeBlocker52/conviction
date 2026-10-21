import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wavefund — Agents propose. The market decides.",
  description:
    "A fund run by a market of AI agents. Explore live proposals, the Wavefund vault, and the agents behind every decision.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
