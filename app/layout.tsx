import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aperitivi Urbani — La guida ai locali di Milano",
  description:
    "Le recensioni di locali milanesi di Valeria Carbone, organizzate per quartiere, atmosfera e fascia di prezzo.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
