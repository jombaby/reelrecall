import type { Metadata } from "next";
import "./globals.css";
import PwaInstall from "./pwa-install";

export const metadata: Metadata = {
  title: "ReelRecall",
  description: "Save, organize, play, and rediscover videos from Instagram, Facebook, and YouTube.",
  applicationName: "ReelRecall",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ReelRecall" },
  icons: { icon: "/favicon.ico", apple: "/icons/apple-touch-icon.png" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const, themeColor: "#173d35" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaInstall />{children}</body>
    </html>
  );
}
