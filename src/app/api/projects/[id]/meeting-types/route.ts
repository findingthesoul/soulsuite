import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Scope, RoutingMode, Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { BUFFER_MINUTES, MIN_NOTICE_MINUTES, MAX_ADVANCE_DAYS } from "@/lib/scheduling-rules";
import { intakeFieldsSchema } from "@/lib/intake";
import { syncIntakeForm } from "@/lib/intake-server";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const rangeSchema = z
  .object({ start: z.string().regex(TIME_RE), end: z.string().regex(TIME_RE) })
  .refine((r) => r.start < r.end, { message: "Start must be before end." });
const dayKey = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const workingHoursSchema = z.record(dayKey, z.array(rangeSchema));

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  bufferBeforeMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z.number().int().refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z.number().int().refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  routingMode: z.enum(["SINGLE", "ROUND_ROBIN", "COLLECTIVE"]).default("SINGLE"),
  // Per-MT fairness rule for ROUND_ROBIN routing. Ignored for SINGLE / COLLECTIVE.
  roundRobinFairness: z
    .enum(["LEAST_RECENTLY_ASSIGNED", "LEAST_LOADED", "STRICT_ROTATION", "RANDOM"])
    .default("LEAST_RECENTLY_ASSIGNED"),
  // SINGLE → exactly 1 host. ROUND_ROBIN → 2 or more.
  assignedHostIds: z.array(z.string().min(1)).min(1),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
  intakeFields: intakeFieldsSchema.default([]),
  conferencingProvider: z
    .enum(["GOOGLE_MEET", "ZOOM", "TEAMS", "IN_PERSON", "PERSONAL_ROOM", "NONE"])
    .default("GOOGLE_MEET"),
  conferencingHostId: z.string().min(1).nullable().optional(),
  defaultLocation: z.string().trim().max(500).nullable().optional(),
  maxInvitees: z.number().int().min(1).max(50).default(1),
  workingHoursOverride: workingHoursSchema.nullable().optional(),
  priceCents: z.number().int().min(50).max(10_000_000).nullable().optional(),
  priceCurrency: z.enum(["eur", "usd", "gbp"]).nullable().optional(),
  paymentMethod: z.enum(["STRIPE", "INVOICE", "ADYEN"]).default("STRIPE"),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, projectId);
  if (!membership || !canManageProject(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;

  // Routing mode invariants. SINGLE = exactly one host; ROUND_ROBIN = at least two.
  if (data.routingMode === "SINGLE" && data.assignedHostIds.length !== 1) {
    return new NextResponse("Single-host mode needs exactly one assigned host.", { status: 400 });
  }
  if (data.routingMode === "ROUND_ROBIN" && data.assignedHostIds.length < 2) {
    return new NextResponse("Round-robin needs at least two assigned hosts.", { status: 400 });
  }
  if (data.routingMode === "COLLECTIVE" && data.assignedHostIds.length < 2) {
    return new NextResponse("Collective needs at least two assigned hosts.", { status: 400 });
  }
  if (data.maxInvitees > 1 && data.routingMode !== "SINGLE") {
    return new NextResponse("Group meetings (maxInvitees > 1) only work with single-host routing.", { status: 400 });
  }

  // Every assignedHostId must be a ProjectMember of this project.
  const members = await prisma.projectMember.findMany({
    where: { projectId, hostId: { in: data.assignedHostIds } },
    select: { hostId: true },
  });
  if (members.length !== data.assignedHostIds.length) {
    return new NextResponse("All assigned hosts must be project members.", { status: 400 });
  }

  // SINGLE mode: conflict calendars must belong to the (single) assigned host. ROUND_ROBIN
  // doesn't support per-meeting-type conflict overrides since hosts have separate calendars —
  // each host's default applies.
  if (data.routingMode === "SINGLE" && data.conflictCalendarIds.length > 0) {
    const owned = await prisma.calendar.findMany({
      where: { hostId: data.assignedHostIds[0], id: { in: data.conflictCalendarIds } },
      select: { id: true },
    });
    if (owned.length !== data.conflictCalendarIds.length) {
      return new NextResponse("Selected calendars must belong to the assigned host.", { status: 400 });
    }
  }
  if (data.routingMode === "ROUND_ROBIN" && data.conflictCalendarIds.length > 0) {
    return new NextResponse(
      "Round-robin can't use a single conflict-calendar override — each host's defaults apply.",
      { status: 400 },
    );
  }
  if (data.routingMode === "COLLECTIVE" && data.conflictCalendarIds.length > 0) {
    return new NextResponse(
      "Collective can't use a single conflict-calendar override — each host's defaults apply.",
      { status: 400 },
    );
  }

  if (data.conferencingProvider === "TEAMS") {
    return new NextResponse("Microsoft Teams is not supported yet.", { status: 400 });
  }
  if (data.conferencingProvider === "IN_PERSON") {
    if (!data.defaultLocation || data.defaultLocation.trim().length === 0) {
      return new NextResponse("Enter a default location for in-person meetings.", { status: 400 });
    }
  }

  // Resolve conferencing host. SINGLE: implicit (assignedHostIds[0]). COLLECTIVE: explicit pick
  // from assignedHostIds. ROUND_ROBIN: not used (each booking uses its picked host).
  let conferencingHostId: string | null = null;
  if (data.routingMode === "COLLECTIVE" && data.conferencingProvider !== "NONE") {
    if (!data.conferencingHostId) {
      return new NextResponse("Pick a conferencing host from the assigned hosts.", { status: 400 });
    }
    if (!data.assignedHostIds.includes(data.conferencingHostId)) {
      return new NextResponse("Conferencing host must be one of the assigned hosts.", { status: 400 });
    }
    conferencingHostId = data.conferencingHostId;
  }

  // Pricing — paid MTs need a currency. STRIPE rail also needs every potential booking host
  // to have a Stripe account connected. INVOICE rail skips that check entirely. ADYEN is a
  // placeholder; UI shouldn't post it but we reject defensively.
  if (data.paymentMethod === "ADYEN") {
    return new NextResponse("Adyen is no longer supported. Pick Stripe or Invoice.", { status: 400 });
  }
  const isPaid = (data.priceCents ?? 0) > 0;
  if (isPaid) {
    if (!data.priceCurrency) {
      return new NextResponse("Pick a currency for paid meeting types.", { status: 400 });
    }
    if (data.paymentMethod === "STRIPE") {
      const stripeRequiredHostIds =
        data.routingMode === "COLLECTIVE"
          ? conferencingHostId
            ? [conferencingHostId]
            : []
          : data.assignedHostIds;
      if (stripeRequiredHostIds.length > 0) {
        const hosts = await prisma.host.findMany({
          where: { id: { in: stripeRequiredHostIds } },
          select: { id: true, name: true, stripeAccountId: true },
        });
        const missing = hosts.filter((h) => !h.stripeAccountId);
        if (missing.length > 0) {
          return new NextResponse(
            `These hosts haven't connected Stripe: ${missing.map((h) => h.name).join(", ")}. Each booking host must connect Stripe under their own Settings → Payments first.`,
            { status: 400 },
          );
        }
      }
    }
  }

  if (data.conferencingProvider === "ZOOM") {
    if (data.routingMode === "COLLECTIVE") {
      // Only the conferencing host needs Zoom; others are added as alternative hosts / guests.
      const confHost = await prisma.host.findUnique({
        where: { id: conferencingHostId! },
        select: { id: true, name: true, zoomRefreshToken: true },
      });
      if (!confHost?.zoomRefreshToken) {
        return new NextResponse(
          `${confHost?.name ?? "Conferencing host"} hasn't connected Zoom.`,
          { status: 400 },
        );
      }
    } else {
      // SINGLE / ROUND_ROBIN: every assigned host needs Zoom (each booking uses its host's account).
      const hosts = await prisma.host.findMany({
        where: { id: { in: data.assignedHostIds } },
        select: { id: true, name: true, zoomRefreshToken: true },
      });
      const missing = hosts.filter((h) => !h.zoomRefreshToken);
      if (missing.length > 0) {
        return new NextResponse(
          `These hosts haven't connected Zoom: ${missing.map((h) => h.name).join(", ")}.`,
          { status: 400 },
        );
      }
    }
  }

  if (data.conferencingProvider === "PERSONAL_ROOM") {
    if (data.routingMode === "COLLECTIVE") {
      const confHost = await prisma.host.findUnique({
        where: { id: conferencingHostId! },
        select: { id: true, name: true, personalRoomUrl: true },
      });
      if (!confHost?.personalRoomUrl) {
        return new NextResponse(
          `${confHost?.name ?? "Conferencing host"} hasn't set a personal room URL on their profile.`,
          { status: 400 },
        );
      }
    } else {
      // SINGLE / ROUND_ROBIN: each booking uses the picked host's URL → every assigned host needs one.
      const hosts = await prisma.host.findMany({
        where: { id: { in: data.assignedHostIds } },
        select: { id: true, name: true, personalRoomUrl: true },
      });
      const missing = hosts.filter((h) => !h.personalRoomUrl);
      if (missing.length > 0) {
        return new NextResponse(
          `These assigned hosts haven't set a personal room URL: ${missing.map((h) => h.name).join(", ")}.`,
          { status: 400 },
        );
      }
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const mt = await tx.meetingType.create({
        data: {
          scope: Scope.PROJECT,
          projectId,
          slug: data.slug,
          name: data.name,
          description: data.description ?? null,
          durationMinutes: data.durationMinutes,
          routingMode:
            data.routingMode === "ROUND_ROBIN"
              ? RoutingMode.ROUND_ROBIN
              : data.routingMode === "COLLECTIVE"
                ? RoutingMode.COLLECTIVE
                : RoutingMode.SINGLE,
          roundRobinFairness: data.roundRobinFairness,
          assignedHostIds: data.assignedHostIds,
          bufferBeforeMinutes: data.bufferBeforeMinutes,
          bufferAfterMinutes: data.bufferAfterMinutes,
          minNoticeMinutes: data.minNoticeMinutes,
          maxAdvanceDays: data.maxAdvanceDays,
          conflictCalendarIds: data.conflictCalendarIds,
          conferencingProvider: data.conferencingProvider,
          conferencingHostId,
          defaultLocation:
            data.conferencingProvider === "IN_PERSON"
              ? data.defaultLocation?.trim() || null
              : null,
          maxInvitees: data.maxInvitees,
          workingHoursOverride: data.workingHoursOverride ?? Prisma.JsonNull,
          priceCents: isPaid ? data.priceCents! : null,
          priceCurrency: isPaid ? data.priceCurrency! : null,
          paymentMethod: isPaid && data.paymentMethod === "INVOICE" ? "INVOICE" : "STRIPE",
        },
      });
      const intakeFormId = await syncIntakeForm({
        meetingTypeId: mt.id,
        scope: "PROJECT",
        projectId,
        fields: data.intakeFields,
        formName: data.name,
        existingIntakeFormId: null,
        tx,
      });
      if (intakeFormId) {
        await tx.meetingType.update({ where: { id: mt.id }, data: { intakeFormId } });
      }
      return mt;
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse(`Slug "${data.slug}" is already taken in this project.`, { status: 409 });
    }
    throw err;
  }
}
