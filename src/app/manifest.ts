import type { MetadataRoute } from "next";

// PWA manifest. The browser uses this to power "Add to Home Screen" / install
// prompts on Android and (with the apple-mobile-web-app-* meta tags below) iOS.
// Icons are placeholders — see scripts/generate-pwa-icons.mjs and the README
// note about swapping in real artwork.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Soul Suite",
    short_name: "Soul Suite",
    description: "Self-hosted scheduling for the Soul collective.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#ffffff",
    background_color: "#ffffff",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
