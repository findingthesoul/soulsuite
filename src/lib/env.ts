import { z } from "zod";

// Validated at module load — fail fast in dev, fail fast in production startup logs.
// Server-only fields are accessed via `serverEnv`; the public ones are available everywhere.

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  WORKSPACE_PRIMARY_EMAIL_DOMAIN: z.string().min(1),
  APP_TOKEN_SECRET: z.string().min(16),
  // Email — both optional. When unset, email-sending is a no-op (logged in dev). Set both
  // in production after configuring Resend + DNS for the sender domain.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
  // Zoom OAuth (User-managed app at marketplace.zoom.us). Both optional — when unset the
  // /settings/connections page hides the Zoom card and meeting types can't pick ZOOM.
  ZOOM_CLIENT_ID: z.string().min(1).optional(),
  ZOOM_CLIENT_SECRET: z.string().min(1).optional(),
  // Microsoft Graph OAuth (Azure AD app registration). Both optional — when unset the
  // /settings/connections page hides the Microsoft Teams card and meeting types can't pick TEAMS.
  // Tenant defaults to "common" so non-Soul invitees can join — see CLAUDE.md notes on multi-tenant.
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_TENANT_ID: z.string().min(1).default("common"),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

// Lazy because the browser bundle must not evaluate this.
let _serverEnv: z.infer<typeof serverSchema> | null = null;
export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() called from the browser");
  }
  if (!_serverEnv) {
    _serverEnv = serverSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      WORKSPACE_PRIMARY_EMAIL_DOMAIN: process.env.WORKSPACE_PRIMARY_EMAIL_DOMAIN,
      APP_TOKEN_SECRET: process.env.APP_TOKEN_SECRET,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
      ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
      ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
      MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
      MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
      MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
    });
  }
  return _serverEnv;
}
