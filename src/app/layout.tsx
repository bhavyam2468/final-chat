import type { Metadata } from "next";
import localFont from "next/font/local";
import "katex/dist/katex.min.css";
import "./globals.css";

// bundled from the geist package: builds and runs offline (local-first)
const sans = localFont({ src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-sans", weight: "100 900" });
const mono = localFont({ src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", variable: "--font-mono", weight: "100 900" });

export const metadata: Metadata = { title: "Workspace", description: "A quiet AI workspace" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'dark'}catch(e){}` }} /></head>
      <body>{children}</body>
    </html>
  );
}
