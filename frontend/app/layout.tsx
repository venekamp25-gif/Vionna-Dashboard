import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Vionna · Product Dashboard",
  description: "Internal product import & generation dashboard for Vionna DK & FR Shopify stores.",
};

// Inline script to set theme BEFORE render — prevents flash of wrong theme
const themeBootstrap = `
(function() {
  try {
    var saved = localStorage.getItem('vionna_theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col font-sans bg-bg text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
