// Root layout for /panel (separate from the storefront's [locale] root). Turkish-only UI.
// Nothing here reads the request: session checks live in Suspense subtrees and pages.
// No <ThemeStyle/>: the panel keeps the default PRESTİJ tokens from globals.css (light + dark),
// so a scheduled seasonal storefront theme never recolors the admin.
import type { Metadata } from "next";
import "@/app/globals.css";
import { fontVariables } from "@/lib/fonts";
import ThemeScript from "@/lib/theme/ThemeScript";

export const metadata: Metadata = {
  title: { default: "PRESTİJ Panel", template: "%s · PRESTİJ Panel" },
  description: "PRESTİJ yönetim paneli",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function PanelRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" dir="ltr" className={fontVariables} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg font-body text-text antialiased">{children}</body>
    </html>
  );
}
