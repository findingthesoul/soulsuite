import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import { SidebarProvider, sidebarInitScript } from "@/components/sidebar-provider";
import { ServiceWorkerRegistration } from "@/components/sw-registration";

export const metadata: Metadata = {
  title: "Soul Suite",
  description: "Self-hosted scheduling for Soul.",
  applicationName: "Soul Suite",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Soul Suite",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set theme class + sidebar mode before first paint to avoid flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <SidebarProvider>{children}</SidebarProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
