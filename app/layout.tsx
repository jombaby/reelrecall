import type { Metadata } from "next";
import "./globals.css";
import PwaRegistration from "./pwa-registration";

export const metadata: Metadata = { title:"ReelRecall", description:"Save it now. Recall it anytime.", applicationName:"ReelRecall", appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"ReelRecall"}, icons:{icon:"/icons/reelrecall.svg",apple:"/icons/reelrecall.svg"} };
export const viewport = { themeColor:"#173d35", width:"device-width", initialScale:1, viewportFit:"cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaRegistration />{children}</body>
    </html>
  );
}
