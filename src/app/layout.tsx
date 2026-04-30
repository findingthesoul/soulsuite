import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import { SidebarProvider, sidebarInitScript } from "@/components/sidebar-provider";

export const metadata: Metadata = {
  title: "Soul Suite",
  description: "Self-hosted scheduling for Soul.",
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
      </body>
    </html>
  );
}
