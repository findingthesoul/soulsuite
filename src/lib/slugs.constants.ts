// Reserved route slugs. Anything that appears as a top-level path segment in src/app/
// MUST be listed here so it can't collide with /{host} or /{project} public routes.
// Seeded into the ReservedSlug table by prisma/seed.ts.
export const RESERVED_SLUGS = [
  "api",
  "auth",
  "dashboard",
  "settings",
  "team",
  "book",
  "onboarding",
  "request-access",
  "invite",
  "poll",
  "_next",
  "static",
  "public",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];
