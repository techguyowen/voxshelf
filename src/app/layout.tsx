import type { Metadata, Viewport } from "next";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeContext";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "VoxShelf — Listen to Anything",
  description:
    "VoxShelf is a self-hostable text-to-speech app. Import PDFs, articles, scans and docs, then listen with karaoke-style highlighting.",
  applicationName: "VoxShelf",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VoxShelf",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

const THEME_INIT = `(function(){try{var t=localStorage.getItem('vs-theme')||localStorage.getItem('vf-theme');if(t!=='light'&&t!=='dark'&&t!=='oled'&&t!=='carolina'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.classList.toggle('dark',t!=='light');document.documentElement.classList.toggle('oled',t==='oled');document.documentElement.classList.toggle('carolina',t==='carolina');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.cdnfonts.com/css/open-dyslexic"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
