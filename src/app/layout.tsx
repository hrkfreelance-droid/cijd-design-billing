import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/providers";
import { getBuildInfo } from "@/lib/build-info";
import "./globals.css";

const build = getBuildInfo();

export const metadata: Metadata = {
  title: "CIJD DESIGN Billing",
  description: "Project, invoicing and payment tracking for CIJD DESIGN.",
  other: {
    "cijd-build-sha": build.commit,
    "cijd-build-branch": build.branch,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

/** Paints the right background before React boots. */
const themeScript = `try{var s=localStorage.getItem('cijd.theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
