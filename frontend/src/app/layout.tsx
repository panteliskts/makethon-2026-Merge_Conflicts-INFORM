import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export const metadata: Metadata = {
  title: "INFORM — Invoice Intelligence",
  description: "Invoice intelligence with grounded answers, source highlights, and bank reconciliation.",
  openGraph: {
    title: "INFORM — Invoice Intelligence",
    description: "Ask invoices questions, inspect the evidence, and reconcile payments from one workspace.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
