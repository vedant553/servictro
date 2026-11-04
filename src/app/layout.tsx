import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ServiceOS — After-Sales Service & Asset Operations",
    template: "%s · ServiceOS",
  },
  description:
    "ServiceOS is the after-sales service and asset operations platform for LT/HT electrical panel and switchgear manufacturers — customers, sites, assets, service requests, work orders, contracts and preventive maintenance in one system.",
  applicationName: "ServiceOS",
  robots: { index: false, follow: false },
  // PWA (audit PWA-01): installable web app manifest + icons.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon-64.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ServiceOS",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1f33",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
