import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { ClientProviders } from "./providers/ClientProviders";
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
        <ClientProviders>
          <ThemeProvider>{children}</ThemeProvider>
        </ClientProviders>
      </body>
    </html>
  );
}
