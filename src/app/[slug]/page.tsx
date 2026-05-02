import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/avatar";
import { RESERVED_SLUGS } from "@/lib/slugs.constants";

// Public landing page — no auth. Lists every active, bookable meeting type for either a host
// (PERSONAL scope) or a project (PROJECT scope). The `[slug]` segment is shared with the
// `/[slug]/[meetingTypeSlug]` booking page; Next.js routes the deeper segment first, so this
// page only ever runs for bare `/{slug}` URLs.
//
// Disambiguation: Host.slug and Project.slug share the same URL space (enforced by
// src/lib/slugs.ts). We resolve Host first (the most common case — every signed-in user has
// one) and fall back to Project. If both ever existed for the same slug the unique-slug check
// would have rejected one of them at creation time, so the order is safe.
export default async function PublicLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) notFound();

  const resolved = await resolvePublicTarget(slug);
  if (!resolved) notFound();

  const { kind, header, brand, meetingTypes } = resolved;

  const inlineStyle = brand.brandColor
    ? ({ "--brand": brand.brandColor } as React.CSSProperties)
    : undefined;

  return (
    <main className="min-h-screen bg-background text-foreground" style={inlineStyle}>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-14">
        <div className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
          <header className="p-6 md:p-8 bg-surface-muted/40 border-b border-border">
            <div className="flex items-start gap-4">
              {kind === "host" && header.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={header.photoUrl}
                  alt={header.title}
                  className="h-12 w-12 rounded-full object-cover border border-border"
                />
              ) : (
                <Avatar name={header.title} size="lg" />
              )}
              <div className="space-y-1 min-w-0">
                {brand.workspaceName && (
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {brand.workspaceName}
                  </p>
                )}
                <h1 className="text-2xl font-semibold tracking-tight leading-tight">
                  {header.title}
                </h1>
                {header.subtitle && (
                  <p className="text-sm text-muted-foreground">{header.subtitle}</p>
                )}
              </div>
              {brand.logoUrl && (
                <div className="ml-auto shrink-0">
                  <Image
                    src={brand.logoUrl}
                    alt={brand.workspaceName ?? ""}
                    width={32}
                    height={32}
                    className="h-8 w-auto opacity-80"
                    unoptimized
                  />
                </div>
              )}
            </div>
            {header.description && (
              <p className="mt-4 text-sm text-foreground whitespace-pre-line">
                {header.description}
              </p>
            )}
          </header>

          <div className="p-4 md:p-6">
            {meetingTypes.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No active scheduling links yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {meetingTypes.map((mt) => (
                  <li key={mt.id}>
                    <Link
                      href={`/${slug}/${mt.slug}`}
                      className="block rounded-md px-3 py-4 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-base font-medium text-foreground">{mt.name}</p>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                          <Clock className="h-3.5 w-3.5" />
                          {mt.durationMinutes} min
                        </span>
                      </div>
                      {mt.description && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {mt.description}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-subtle-foreground">Powered by Soul Suite</p>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// Resolver — host first, project second
// ────────────────────────────────────────────────────────────

interface PublicMeetingType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
}

interface PublicHeader {
  title: string;
  subtitle: string | null;
  description: string | null;
  photoUrl: string | null;
}

interface PublicBrand {
  workspaceName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
}

type Resolved =
  | { kind: "host"; header: PublicHeader; brand: PublicBrand; meetingTypes: PublicMeetingType[] }
  | { kind: "project"; header: PublicHeader; brand: PublicBrand; meetingTypes: PublicMeetingType[] };

async function resolvePublicTarget(slug: string): Promise<Resolved | null> {
  // Path A — host landing.
  const host = await prisma.host.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      bio: true,
      location: true,
      timezone: true,
      photoUrl: true,
      personalMeetingTypes: {
        where: { isActive: true, isOneOff: false },
        orderBy: { durationMinutes: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          durationMinutes: true,
        },
      },
      workspaceMembers: {
        select: {
          workspace: {
            select: { name: true, logoUrl: true, brandColor: true },
          },
        },
        take: 1,
      },
    },
  });

  if (host) {
    const ws = host.workspaceMembers[0]?.workspace ?? null;
    return {
      kind: "host",
      header: {
        title: host.name,
        subtitle: host.location ? `${host.location} · ${host.timezone}` : host.timezone,
        description: host.bio,
        photoUrl: host.photoUrl,
      },
      brand: {
        workspaceName: ws?.name ?? null,
        logoUrl: ws?.logoUrl ?? null,
        brandColor: ws?.brandColor ?? null,
      },
      meetingTypes: host.personalMeetingTypes,
    };
  }

  // Path B — project landing.
  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      workspace: {
        select: { name: true, logoUrl: true, brandColor: true },
      },
      meetingTypes: {
        where: { isActive: true, isOneOff: false },
        orderBy: { durationMinutes: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          durationMinutes: true,
        },
      },
    },
  });

  if (!project || !project.isActive) return null;

  return {
    kind: "project",
    header: {
      title: project.name,
      subtitle: null,
      description: project.description,
      photoUrl: null,
    },
    brand: {
      workspaceName: project.workspace.name,
      logoUrl: project.workspace.logoUrl,
      brandColor: project.workspace.brandColor,
    },
    meetingTypes: project.meetingTypes,
  };
}
