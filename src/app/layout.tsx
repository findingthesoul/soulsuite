import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider, themeInitScript, type ThemeMode } from "@/components/theme-provider";
import { SidebarProvider, sidebarInitScript } from "@/components/sidebar-provider";
import { ServiceWorkerRegistration } from "@/components/sw-registration";
import { getCurrentHost } from "@/lib/auth";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pull the signed-in host's saved theme so the preference follows the account across
  // browsers + devices. getCurrentHost is cached per-request via React.cache, so this
  // doesn't add a duplicate roundtrip when page-context also calls it. Returns null for
  // signed-out requests — the client falls back to localStorage then "system".
  const host = await getCurrentHost();
  const initialMode: ThemeMode | null = host
    ? host.themePreference === "LIGHT"
      ? "light"
      : host.themePreference === "DARK"
        ? "dark"
        : "system"
    : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set theme class + sidebar mode before first paint to avoid flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body className="antialiased">
        <ThemeProvider initialMode={initialMode}>
          <SidebarProvider>{children}</SidebarProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
