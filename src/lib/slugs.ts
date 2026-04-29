import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RESERVED_SLUGS } from "@/lib/slugs.constants";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function normaliseSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function isWellFormedSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// Cross-table availability check. Run inside a transaction with `assertSlugAvailable(slug, tx)`
// when reserving a Host or Project slug; the brief calls for DB-level enforcement which a future
// raw-SQL trigger migration will add — until then this is the single chokepoint.
export async function assertSlugAvailable(
  slug: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const value = normaliseSlug(slug);
  if (!isWellFormedSlug(value)) {
    throw new SlugError(`"${slug}" is not a valid slug. Use lowercase letters, digits, and hyphens (2–40 chars).`);
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(value)) {
    throw new SlugError(`"${value}" is a reserved route and cannot be used.`);
  }
  const [reserved, host, project] = await Promise.all([
    client.reservedSlug.findUnique({ where: { value } }),
    client.host.findUnique({ where: { slug: value } }),
    client.project.findUnique({ where: { slug: value } }),
  ]);
  if (reserved || host || project) {
    throw new SlugError(`"${value}" is already taken.`);
  }
}

export class SlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlugError";
  }
}

// Generates a unique slug from a name by suffixing -2, -3, ... if needed. Used during onboarding
// when we mint a host slug from their display name.
export async function generateUniqueSlug(base: string): Promise<string> {
  const root = normaliseSlug(base)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 38);
  if (!root) return generateUniqueSlug(`host-${Math.random().toString(36).slice(2, 8)}`);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    try {
      await assertSlugAvailable(candidate);
      return candidate;
    } catch (e) {
      if (e instanceof SlugError) continue;
      throw e;
    }
  }
  throw new SlugError(`Could not generate a unique slug from "${base}".`);
}
