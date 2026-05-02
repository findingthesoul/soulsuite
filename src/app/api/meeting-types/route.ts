import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Scope, RoutingMode, Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
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
  bufferBeforeMinutes: z
    .number()
    .int()
    .refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z
    .number()
    .int()
    .refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z
    .number()
    .int()
    .refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z
    .number()
    .int()
    .refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
  intakeFields: intakeFieldsSchema.default([]),
  isActive: z.boolean().optional(),
  conferencingProvider: z.enum(["GOOGLE_MEET", "ZOOM", "TEAMS", "NONE"]).default("GOOGLE_MEET"),
  maxInvitees: z.number().int().min(1).max(50).default(1),
  workingHoursOverride: workingHoursSchema.nullable().optional(),
  // Pricing — paid meeting types route through Stripe Checkout. Both fields null = free.
  priceCents: z.number().int().min(50).max(10_000_000).nullable().optional(),
  priceCurrency: z.enum(["eur", "usd", "gbp"]).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;

  if (data.conferencingProvider === "ZOOM" && !host.zoomRefreshToken) {
    return new NextResponse("Connect Zoom in Settings → Connections before using it.", { status: 400 });
  }
  if (data.conferencingProvider === "TEAMS") {
    return new NextResponse("Microsoft Teams is not supported yet.", { status: 400 });
  }

  // Pricing: paid MTs require the host to have a Stripe account configured.
  const isPaid = (data.priceCents ?? 0) > 0;
  if (isPaid && !data.priceCurrency) {
    return new NextResponse("Pick a currency for paid meeting types.", { status: 400 });
  }
  if (isPaid && !host.stripeAccountId) {
    return new NextResponse("Connect Stripe under Settings → Payments first.", { status: 400 });
  }

  if (data.conflictCalendarIds.length > 0) {
    const owned = await prisma.calendar.findMany({
      where: { hostId: host.id, id: { in: data.conflictCalendarIds } },
      select: { id: true },
    });
    if (owned.length !== data.conflictCalendarIds.length) {
      return new NextResponse("One or more selected calendars don't belong to you.", { status: 400 });
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const mt = await tx.meetingType.create({
        data: {
          scope: Scope.PERSONAL,
          hostId: host.id,
          slug: data.slug,
          name: data.name,
          description: data.description ?? null,
          durationMinutes: data.durationMinutes,
          routingMode: RoutingMode.SINGLE,
          assignedHostIds: [host.id],
          bufferBeforeMinutes: data.bufferBeforeMinutes,
          bufferAfterMinutes: data.bufferAfterMinutes,
          minNoticeMinutes: data.minNoticeMinutes,
          maxAdvanceDays: data.maxAdvanceDays,
          conflictCalendarIds: data.conflictCalendarIds,
          conferencingProvider: data.conferencingProvider,
          maxInvitees: data.maxInvitees,
          workingHoursOverride: data.workingHoursOverride ?? Prisma.JsonNull,
          priceCents: isPaid ? data.priceCents! : null,
          priceCurrency: isPaid ? data.priceCurrency! : null,
        },
      });
      const intakeFormId = await syncIntakeForm({
        meetingTypeId: mt.id,
        scope: "PERSONAL",
        hostId: host.id,
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
    if (isPrismaUniqueViolation(err)) {
      return new NextResponse(`Slug "${data.slug}" is already taken on your meeting types.`, { status: 409 });
    }
    throw err;
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002");
}
