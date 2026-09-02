import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReelRecall",
  description: "Save, organize, play, and rediscover videos from Instagram, Facebook, and YouTube.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
