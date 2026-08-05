// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { getSiteUrlObject } from "@/lib/site-url";

export const metadata: Metadata = {
  // Resolved defensively — see src/lib/site-url.ts. A raw
  // `new URL(process.env.SOMETHING)` here runs during static generation and
  // fails the whole build with `TypeError: Invalid URL` if the variable is
  // malformed rather than merely absent.
  metadataBase: getSiteUrlObject(),
  title: "AssurPilot — Gestion des appels",
  description: "Plateforme de gestion des appels entrants pour assurances",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
