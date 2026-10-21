import type { Metadata, Viewport } from "next";
import "./globals.css";
// Tema highlight untuk blok kode (badge terang/gelap dikendalikan class html).
import "highlight.js/styles/base16/gruvbox-dark-medium.css";

export const metadata: Metadata = {
  title: "AI Pribadi",
  description: "Asisten AI pribadi — percakapan, analisis file, dan mode coding.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Merender class tema sedini mungkin agar tidak ada kilat putih (flash)
 * saat aplikasi dibuka dengan tema gelap.
 */
const themeInit = `
(function(){
  try {
    var t = localStorage.getItem("pa-theme");
    if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.add("light");
    }
  } catch (e) {
    document.documentElement.classList.add("light");
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
