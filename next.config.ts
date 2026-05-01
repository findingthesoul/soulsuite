import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Typed routes generates `RouteImpl<>` types that reject template-literal strings; we use
  // dynamic URLs everywhere (`/${slug}/${mtSlug}/...`) so it's more friction than help.
  typedRoutes: false,
  experimental: {
    // Keep router-cache entries warm so re-navigating between sidebar tabs (Home, Bookings,
    // Personal, Teams, Settings) within 30s skips the RSC fetch entirely. Default in Next 15
    // is 0s for dynamic routes which makes the app feel slow on every internal nav. 30s
    // matches our other in-memory caches.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default config;
