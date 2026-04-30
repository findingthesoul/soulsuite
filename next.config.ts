import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Typed routes generates `RouteImpl<>` types that reject template-literal strings; we use
  // dynamic URLs everywhere (`/${slug}/${mtSlug}/...`) so it's more friction than help.
  typedRoutes: false,
};

export default config;
