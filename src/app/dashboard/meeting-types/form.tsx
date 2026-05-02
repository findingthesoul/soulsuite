"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";
import { DirtyNavGuard } from "@/components/dirty-nav-guard";
import {
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  MAX_ADVANCE_DAYS,
  formatMinutes,
} from "@/lib/scheduling-rules";
import { type IntakeField } from "@/lib/intake";
import { IntakeFieldsEditor } from "@/components/intake-fields-editor";
import {
  WorkingHoursEditor,
  coerceSchedule,
  defaultSchedule,
  type Schedule,
} from "@/components/working-hours-editor";

interface Initial {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  conflictCalendarIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
  maxInvitees: number;
  workingHoursOverride: Schedule | null;
  priceCents: number | null;
  priceCurrency: string | null;
  paymentMethod: PaymentMethod;
}

// Mirrors the Prisma enum + the UI-only "ADYEN" placeholder. ADYEN is rejected by the API; we
// surface it as a disabled option so users can see it's planned without us having to write a
// real handler yet.
export type PaymentMethod = "STRIPE" | "INVOICE" | "ADYEN";

const SUPPORTED_CURRENCIES = ["eur", "usd", "gbp"] as const;

export type ConferencingProvider = "GOOGLE_MEET" | "ZOOM" | "TEAMS" | "NONE";

export interface HostCalendar {
  id: string;
  summary: string;
  role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET";
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function autoSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

interface DraftValues {
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  conflictCalendarIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
  maxInvitees: number;
  workingHoursOverride: Schedule | null;
  // Pricing — paid is "on" when priceMajor (string for input control) > 0. We keep the raw
  // string so the user can clear/retype freely.
  isPaid: boolean;
  priceMajor: string;
  priceCurrency: string;
  paymentMethod: PaymentMethod;
}

const DRAFT_DEFAULT: DraftValues = {
  name: "",
  slug: "",
  description: "",
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 60,
  maxAdvanceDays: 60,
  conflictCalendarIds: [],
  intakeFields: [],
  isActive: true,
  conferencingProvider: "GOOGLE_MEET",
  maxInvitees: 1,
  workingHoursOverride: null,
  isPaid: false,
  priceMajor: "",
  priceCurrency: "eur",
  paymentMethod: "STRIPE",
};

function initialToDraft(initial: Initial): DraftValues {
  const isPaid = (initial.priceCents ?? 0) > 0;
  return {
    name: initial.name,
    slug: initial.slug,
    description: initial.description ?? "",
    durationMinutes: initial.durationMinutes,
    bufferBeforeMinutes: initial.bufferBeforeMinutes,
    bufferAfterMinutes: initial.bufferAfterMinutes,
    minNoticeMinutes: initial.minNoticeMinutes,
    maxAdvanceDays: initial.maxAdvanceDays,
    conflictCalendarIds: initial.conflictCalendarIds,
    intakeFields: initial.intakeFields,
    isActive: initial.isActive,
    conferencingProvider: initial.conferencingProvider,
    maxInvitees: initial.maxInvitees,
    workingHoursOverride: initial.workingHoursOverride,
    isPaid,
    priceMajor: isPaid && initial.priceCents != null ? (initial.priceCents / 100).toString() : "",
    priceCurrency: initial.priceCurrency ?? "eur",
    paymentMethod: initial.paymentMethod,
  };
}

// Pricing payload helpers — convert the draft's UI-friendly fields back to (priceCents, priceCurrency)
// for the API.
function pricingPayload(draft: DraftValues):
  | { priceCents: number; priceCurrency: string }
  | { priceCents: null; priceCurrency: null } {
  if (!draft.isPaid) return { priceCents: null, priceCurrency: null };
  const major = Number(draft.priceMajor);
  if (!Number.isFinite(major) || major <= 0) {
    return { priceCents: null, priceCurrency: null };
  }
  return {
    priceCents: Math.round(major * 100),
    priceCurrency: draft.priceCurrency,
  };
}

function validatePricing(draft: DraftValues, hostHasStripe: boolean): string | null {
  if (!draft.isPaid) return null;
  if (draft.paymentMethod === "ADYEN") {
    return "Adyen isn't available yet — pick Stripe or invoice.";
  }
  if (draft.paymentMethod === "STRIPE" && !hostHasStripe) {
    return "Connect Stripe under Settings → Payments first.";
  }
  const major = Number(draft.priceMajor);
  if (!Number.isFinite(major) || major <= 0) {
    return "Enter a price greater than 0.";
  }
  // The 0.50 minimum is a Stripe constraint; invoice has no such floor (the host can charge
  // anything they want on the manual invoice). Keep the check to catch typos either way.
  if (draft.paymentMethod === "STRIPE" && Math.round(major * 100) < 50) {
    return "Stripe requires a minimum charge of 0.50.";
  }
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(draft.priceCurrency)) {
    return "Pick a currency.";
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Tab-aware validation (personal MT)
// ────────────────────────────────────────────────────────────

type PersonalTabKey = "basics" | "availability" | "conferencing" | "pricing" | "intake";

const PERSONAL_TAB_ORDER: PersonalTabKey[] = [
  "basics",
  "availability",
  "conferencing",
  "pricing",
  "intake",
];

interface TabError {
  tabKey: PersonalTabKey;
  message: string;
}

function validatePersonalDraft(
  draft: DraftValues,
  hostHasZoom: boolean,
  hostHasStripe: boolean,
): TabError[] {
  const errors: TabError[] = [];
  if (draft.name.trim().length < 2) {
    errors.push({ tabKey: "basics", message: "Name is required." });
  }
  if (!SLUG_RE.test(draft.slug)) {
    errors.push({
      tabKey: "basics",
      message: "Slug must be 2–40 chars, lowercase letters/digits/hyphens.",
    });
  }
  if (![15, 30, 45, 60, 90, 120].includes(draft.durationMinutes)) {
    errors.push({
      tabKey: "basics",
      message: "Duration must be 15, 30, 45, 60, 90, or 120 minutes.",
    });
  }
  if (!Number.isInteger(draft.maxInvitees) || draft.maxInvitees < 1 || draft.maxInvitees > 50) {
    errors.push({
      tabKey: "basics",
      message: "Max invitees must be a whole number between 1 and 50.",
    });
  }
  if (draft.conferencingProvider === "ZOOM" && !hostHasZoom) {
    errors.push({
      tabKey: "conferencing",
      message: "Connect Zoom in Settings → Connections before picking it.",
    });
  }
  const pricingErr = validatePricing(draft, hostHasStripe);
  if (pricingErr) {
    errors.push({ tabKey: "pricing", message: pricingErr });
  }
  return errors;
}

export function MeetingTypeForm({
  hostSlug,
  hostCalendars,
  hostHasZoom,
  hostHasStripe,
  initial,
}: {
  hostSlug: string;
  hostCalendars: HostCalendar[];
  hostHasZoom: boolean;
  hostHasStripe: boolean;
  initial?: Initial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  // Edit-existing path: direct-edit pattern with top-right SaveBar.
  if (isEdit && initial) {
    return (
      <EditMeetingTypeForm
        hostSlug={hostSlug}
        hostCalendars={hostCalendars}
        hostHasZoom={hostHasZoom}
        hostHasStripe={hostHasStripe}
        initial={initial}
      />
    );
  }

  // Create path keeps its own bottom CTA — see brief / feedback memo.
  return (
    <CreateMeetingTypeForm
      hostSlug={hostSlug}
      hostCalendars={hostCalendars}
      hostHasZoom={hostHasZoom}
      hostHasStripe={hostHasStripe}
      onCreated={(id) => {
        // unused for now; create POST returns id but redirect is enough.
        void id;
      }}
      router={router}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Edit (direct-edit pattern)
// ────────────────────────────────────────────────────────────

function EditMeetingTypeForm({
  hostSlug,
  hostCalendars,
  hostHasZoom,
  hostHasStripe,
  initial,
}: {
  hostSlug: string;
  hostCalendars: HostCalendar[];
  hostHasZoom: boolean;
  hostHasStripe: boolean;
  initial: Initial;
}) {
  const router = useRouter();
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<DraftValues>(initialToDraft(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PersonalTabKey>("basics");
  const [tabErrors, setTabErrors] = useState<TabError[]>([]);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft({ ...draft, [key]: value });
  }

  function handleNameChange(value: string) {
    // After the first save the slug is "touched" — auto-slugging from the name in edit mode
    // would silently change the public URL. Users still type into the slug field directly.
    update("name", value);
  }

  function discard() {
    setError(null);
    setTabErrors([]);
    reset();
  }

  function save() {
    setError(null);
    const errors = validatePersonalDraft(draft, hostHasZoom, hostHasStripe);
    if (errors.length > 0) {
      setTabErrors(errors);
      // Auto-switch to first tab with an error.
      const firstWithError = PERSONAL_TAB_ORDER.find((t) => errors.some((e) => e.tabKey === t));
      if (firstWithError) setActiveTab(firstWithError);
      setError(errors[0].message);
      return;
    }
    setTabErrors([]);
    const overridePayload = serialiseOverride(draft.workingHoursOverride);
    const pricing = pricingPayload(draft);

    startTransition(async () => {
      const res = await fetch(`/api/meeting-types/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug,
          description: draft.description.trim() || null,
          durationMinutes: draft.durationMinutes,
          bufferBeforeMinutes: draft.bufferBeforeMinutes,
          bufferAfterMinutes: draft.bufferAfterMinutes,
          minNoticeMinutes: draft.minNoticeMinutes,
          maxAdvanceDays: draft.maxAdvanceDays,
          conflictCalendarIds: draft.conflictCalendarIds,
          intakeFields: draft.intakeFields,
          isActive: draft.isActive,
          conferencingProvider: draft.conferencingProvider,
          maxInvitees: draft.maxInvitees,
          workingHoursOverride: overridePayload,
          priceCents: pricing.priceCents,
          priceCurrency: pricing.priceCurrency,
          paymentMethod: draft.isPaid ? draft.paymentMethod : "STRIPE",
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      commit({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
      });
      router.refresh();
    });
  }

  async function destroy() {
    if (!confirm("Delete this meeting type? Existing bookings stay; the public link will 404.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/meeting-types/${initial.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.text()) || "Failed to delete");
        return;
      }
      router.push("/dashboard/meeting-types");
      router.refresh();
    });
  }

  const errorCount = (key: PersonalTabKey) => tabErrors.filter((e) => e.tabKey === key).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit meeting type"
        description={`Booking link: /${hostSlug}/${draft.slug || initial.slug}`}
        actions={<SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />}
      />
      <DirtyNavGuard dirty={dirty} onSave={save} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PersonalTabKey)}>
        <TabsList>
          <TabsTrigger value="basics" errorCount={errorCount("basics")}>
            Basics
          </TabsTrigger>
          <TabsTrigger value="availability" errorCount={errorCount("availability")}>
            Availability
          </TabsTrigger>
          <TabsTrigger value="conferencing" errorCount={errorCount("conferencing")}>
            Conferencing
          </TabsTrigger>
          <TabsTrigger value="pricing" errorCount={errorCount("pricing")}>
            Pricing
          </TabsTrigger>
          <TabsTrigger value="intake" errorCount={errorCount("intake")}>
            Intake
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basics">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Name, slug, and duration are the essentials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailsEditor
                draft={draft}
                update={update}
                hostSlug={hostSlug}
                isEdit
                onNameChange={handleNameChange}
                onSlugChange={(v) => update("slug", v.toLowerCase())}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Group bookings</CardTitle>
              <CardDescription>How many invitees can claim the same time slot. 1 keeps it 1:1.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <Label htmlFor="maxInvitees">Max invitees per slot</Label>
                <Input
                  id="maxInvitees"
                  type="number"
                  min={1}
                  max={50}
                  value={draft.maxInvitees}
                  onChange={(e) =>
                    update("maxInvitees", Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  When &gt;1 the same slot accepts multiple bookings on a single calendar event.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
              <CardDescription>
                Defaults to your overall <Link href="/settings/availability" className="underline">working hours</Link>.
                Override here when this meeting type only happens at specific times.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AvailabilityEditor draft={draft} update={update} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scheduling rules</CardTitle>
              <CardDescription>Buffers, how soon people can book, and how far ahead.</CardDescription>
            </CardHeader>
            <CardContent>
              <SchedulingEditor draft={draft} update={update} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conferencing">
          <Card>
            <CardHeader>
              <CardTitle>Conferencing</CardTitle>
              <CardDescription>Where the meeting happens. Zoom requires you to connect it in Settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <ConferencingEditor draft={draft} update={update} hostHasZoom={hostHasZoom} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conflict calendars</CardTitle>
              <CardDescription>
                Which of your calendars block this meeting type. Default uses every conflict-source you set in
                <Link href="/settings/calendars" className="underline ml-1">Settings → Calendars</Link>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={hostCalendars} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing">
          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
              <CardDescription>
                Charge invitees through Stripe Checkout before the booking is confirmed. Free meetings skip
                payment entirely.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PricingEditor draft={draft} update={update} hostHasStripe={hostHasStripe} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="intake">
          <Card>
            <CardHeader>
              <CardTitle>Intake questions</CardTitle>
              <CardDescription>
                Optional questions shown after the slot is picked. Answers are stored on the booking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IntakeFieldsEditor
                fields={draft.intakeFields}
                onChange={(next) => update("intakeFields", next)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-start">
        <Button variant="destructive" onClick={destroy} disabled={pending}>
          Delete
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Create (legacy bottom-CTA pattern — kept by design)
// ────────────────────────────────────────────────────────────

type Router = ReturnType<typeof useRouter>;

function CreateMeetingTypeForm({
  hostSlug,
  hostCalendars,
  hostHasZoom,
  hostHasStripe,
  router,
}: {
  hostSlug: string;
  hostCalendars: HostCalendar[];
  hostHasZoom: boolean;
  hostHasStripe: boolean;
  onCreated: (id: string) => void;
  router: Router;
}) {
  const [draft, setDraft] = useState<DraftValues>(DRAFT_DEFAULT);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleNameChange(value: string) {
    update("name", value);
    if (!slugTouched) update("slug", autoSlug(value));
  }

  function cancel() {
    router.push("/dashboard/meeting-types");
  }

  function submit() {
    setError(null);
    if (draft.name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(draft.slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    if (![15, 30, 45, 60, 90, 120].includes(draft.durationMinutes)) {
      return setError("Duration must be 15, 30, 45, 60, 90, or 120 minutes.");
    }
    if (draft.conferencingProvider === "ZOOM" && !hostHasZoom) {
      return setError("Connect Zoom in Settings → Connections before picking it.");
    }
    if (!Number.isInteger(draft.maxInvitees) || draft.maxInvitees < 1 || draft.maxInvitees > 50) {
      return setError("Max invitees must be a whole number between 1 and 50.");
    }
    const pricingErr = validatePricing(draft, hostHasStripe);
    if (pricingErr) return setError(pricingErr);
    const overridePayload = serialiseOverride(draft.workingHoursOverride);
    const pricing = pricingPayload(draft);

    startTransition(async () => {
      const res = await fetch(`/api/meeting-types`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug,
          description: draft.description.trim() || null,
          durationMinutes: draft.durationMinutes,
          bufferBeforeMinutes: draft.bufferBeforeMinutes,
          bufferAfterMinutes: draft.bufferAfterMinutes,
          minNoticeMinutes: draft.minNoticeMinutes,
          maxAdvanceDays: draft.maxAdvanceDays,
          conflictCalendarIds: draft.conflictCalendarIds,
          intakeFields: draft.intakeFields,
          isActive: draft.isActive,
          conferencingProvider: draft.conferencingProvider,
          maxInvitees: draft.maxInvitees,
          workingHoursOverride: overridePayload,
          priceCents: pricing.priceCents,
          priceCurrency: pricing.priceCurrency,
          paymentMethod: draft.isPaid ? draft.paymentMethod : "STRIPE",
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      router.push("/dashboard/meeting-types");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name, slug, and duration are the essentials.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailsEditor
            draft={draft}
            update={update}
            hostSlug={hostSlug}
            isEdit={false}
            onNameChange={handleNameChange}
            onSlugChange={(v) => {
              update("slug", v.toLowerCase());
              setSlugTouched(true);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling rules</CardTitle>
          <CardDescription>Buffers, how soon people can book, and how far ahead.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulingEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>
            Defaults to your overall <Link href="/settings/availability" className="underline">working hours</Link>.
            Override here when this meeting type only happens at specific times.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Group bookings</CardTitle>
          <CardDescription>How many invitees can claim the same time slot. 1 keeps it 1:1.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="maxInvitees">Max invitees per slot</Label>
            <Input
              id="maxInvitees"
              type="number"
              min={1}
              max={50}
              value={draft.maxInvitees}
              onChange={(e) =>
                update("maxInvitees", Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conferencing</CardTitle>
          <CardDescription>Where the meeting happens. Zoom requires you to connect it in Settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConferencingEditor draft={draft} update={update} hostHasZoom={hostHasZoom} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intake questions</CardTitle>
          <CardDescription>
            Optional questions shown after the slot is picked. Answers are stored on the booking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntakeFieldsEditor
            fields={draft.intakeFields}
            onChange={(next) => update("intakeFields", next)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>
            Charge invitees through Stripe Checkout before the booking is confirmed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PricingEditor draft={draft} update={update} hostHasStripe={hostHasStripe} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conflict calendars</CardTitle>
          <CardDescription>
            Which of your calendars block this meeting type. Default uses every conflict-source you set in
            <Link href="/settings/calendars" className="underline ml-1">Settings → Calendars</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={hostCalendars} />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Create"}
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Shared editors
// ────────────────────────────────────────────────────────────

function DetailsEditor({
  draft,
  update,
  hostSlug,
  isEdit,
  onNameChange,
  onSlugChange,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  hostSlug: string;
  isEdit: boolean;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={draft.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Intro call"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/{hostSlug}/</span>
          <Input
            id="slug"
            value={draft.slug}
            onChange={(e) => onSlugChange(e.target.value)}
            placeholder="intro-call"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="duration">Duration</Label>
        <Select
          id="duration"
          value={String(draft.durationMinutes)}
          onChange={(e) => update("durationMinutes", Number(e.target.value))}
        >
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
          <option value="90">90 minutes</option>
          <option value="120">120 minutes</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder="Shown on the booking page."
          className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>
      {isEdit && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
            className="h-4 w-4 rounded border-border accent-foreground"
          />
          Active — accept new bookings
        </label>
      )}
    </>
  );
}

function SchedulingEditor({
  draft,
  update,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bufferBefore">Buffer before</Label>
          <Select
            id="bufferBefore"
            value={String(draft.bufferBeforeMinutes)}
            onChange={(e) => update("bufferBeforeMinutes", Number(e.target.value))}
          >
            {BUFFER_MINUTES.map((m) => (
              <option key={m} value={String(m)}>
                {m === 0 ? "None" : `${m} min`}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bufferAfter">Buffer after</Label>
          <Select
            id="bufferAfter"
            value={String(draft.bufferAfterMinutes)}
            onChange={(e) => update("bufferAfterMinutes", Number(e.target.value))}
          >
            {BUFFER_MINUTES.map((m) => (
              <option key={m} value={String(m)}>
                {m === 0 ? "None" : `${m} min`}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Buffers reserve quiet time around the meeting; e.g. 15 min after means the next slot can&apos;t start
        until 15 min after this one ends.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="minNotice">Minimum notice</Label>
          <Select
            id="minNotice"
            value={String(draft.minNoticeMinutes)}
            onChange={(e) => update("minNoticeMinutes", Number(e.target.value))}
          >
            {MIN_NOTICE_MINUTES.map((m) => (
              <option key={m} value={String(m)}>
                {formatMinutes(m)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxAdvance">Bookable up to</Label>
          <Select
            id="maxAdvance"
            value={String(draft.maxAdvanceDays)}
            onChange={(e) => update("maxAdvanceDays", Number(e.target.value))}
          >
            {MAX_ADVANCE_DAYS.map((d) => (
              <option key={d} value={String(d)}>
                {d} days
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

function AvailabilityEditor({
  draft,
  update,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
}) {
  const overrideOn = draft.workingHoursOverride !== null;
  function toggleOverride(on: boolean) {
    update("workingHoursOverride", on ? defaultSchedule() : null);
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="availabilityMode"
            checked={!overrideOn}
            onChange={() => toggleOverride(false)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Use my default working hours
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="availabilityMode"
            checked={overrideOn}
            onChange={() => toggleOverride(true)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Custom for this meeting type
        </label>
      </div>
      {overrideOn && draft.workingHoursOverride && (
        <WorkingHoursEditor
          value={draft.workingHoursOverride}
          onChange={(next) => update("workingHoursOverride", next)}
        />
      )}
    </div>
  );
}

function ConflictCalendarsEditor({
  draft,
  update,
  hostCalendars,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  hostCalendars: HostCalendar[];
}) {
  const overrideOn = draft.conflictCalendarIds.length > 0;

  function toggleOverride(on: boolean) {
    if (on) {
      const defaults = hostCalendars
        .filter((c) => c.role === "CONFLICT_CHECK" || c.role === "WRITE_TARGET")
        .map((c) => c.id);
      update("conflictCalendarIds", defaults);
    } else {
      update("conflictCalendarIds", []);
    }
  }

  function toggleCalendar(id: string, checked: boolean) {
    const set = new Set(draft.conflictCalendarIds);
    if (checked) set.add(id);
    else set.delete(id);
    update("conflictCalendarIds", Array.from(set));
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!overrideOn}
          onChange={(e) => toggleOverride(!e.target.checked)}
          className="h-4 w-4 rounded border-border accent-foreground"
        />
        Use host default (every conflict-source calendar)
      </label>
      {overrideOn && (
        <ul className="rounded-md border border-border divide-y divide-border">
          {hostCalendars.map((c) => {
            const checked = draft.conflictCalendarIds.includes(c.id);
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3">
                <label className="flex items-center gap-2 text-sm flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleCalendar(c.id, e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-foreground shrink-0"
                  />
                  <span className="truncate text-foreground">{c.summary}</span>
                </label>
                <span className="text-xs uppercase tracking-wide text-subtle-foreground shrink-0">
                  {c.role === "WRITE_TARGET" ? "Write" : c.role === "CONFLICT_CHECK" ? "Conflict" : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ConferencingEditor({
  draft,
  update,
  hostHasZoom,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  hostHasZoom: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="conferencingProvider">Provider</Label>
      <Select
        id="conferencingProvider"
        value={draft.conferencingProvider}
        onChange={(e) => update("conferencingProvider", e.target.value as ConferencingProvider)}
      >
        <option value="GOOGLE_MEET">Google Meet</option>
        <option value="ZOOM" disabled={!hostHasZoom}>
          Zoom{hostHasZoom ? "" : " — connect in Settings → Connections first"}
        </option>
        <option value="TEAMS" disabled>
          Microsoft Teams — coming later
        </option>
        <option value="NONE">None (no conferencing link)</option>
      </Select>
    </div>
  );
}

function PricingEditor({
  draft,
  update,
  hostHasStripe,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  hostHasStripe: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="pricingMode"
            checked={!draft.isPaid}
            onChange={() => update("isPaid", false)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Free
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="pricingMode"
            checked={draft.isPaid}
            onChange={() => update("isPaid", true)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Paid (collected via Stripe Checkout)
        </label>
      </div>
      {draft.isPaid && (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1.5">
            <Label htmlFor="priceMajor">Amount</Label>
            <Input
              id="priceMajor"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft.priceMajor}
              onChange={(e) => update("priceMajor", e.target.value)}
              placeholder="150"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priceCurrency">Currency</Label>
            <Select
              id="priceCurrency"
              value={draft.priceCurrency}
              onChange={(e) => update("priceCurrency", e.target.value)}
            >
              <option value="eur">EUR (€)</option>
              <option value="usd">USD ($)</option>
              <option value="gbp">GBP (£)</option>
            </Select>
          </div>
        </div>
      )}
      {draft.isPaid && (
        <PaymentMethodPicker
          value={draft.paymentMethod}
          onChange={(v) => update("paymentMethod", v)}
        />
      )}
      {draft.isPaid && draft.paymentMethod === "STRIPE" && !hostHasStripe && (
        <p className="text-xs text-destructive">
          Connect Stripe under Settings → Payments first.
        </p>
      )}
    </div>
  );
}

// Payment-method radio shared by personal + project pricing editors. Adyen renders disabled to
// signal it's planned without us shipping any code path for it.
export function PaymentMethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Payment method</Label>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="paymentMethod"
            checked={value === "STRIPE"}
            onChange={() => onChange("STRIPE")}
            className="h-4 w-4 mt-0.5 border-border accent-foreground"
          />
          <span>
            <span className="text-foreground">Stripe (online card)</span>
            <span className="block text-xs text-muted-foreground">
              Invitee pays via Stripe Checkout before the booking is confirmed.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="paymentMethod"
            checked={value === "INVOICE"}
            onChange={() => onChange("INVOICE")}
            className="h-4 w-4 mt-0.5 border-border accent-foreground"
          />
          <span>
            <span className="text-foreground">Pay by invoice</span>
            <span className="block text-xs text-muted-foreground">
              Invitee fills in billing details at booking time. You send the invoice from your own
              system after the meeting is booked.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 opacity-60 cursor-not-allowed">
          <input
            type="radio"
            name="paymentMethod"
            checked={value === "ADYEN"}
            onChange={() => onChange("ADYEN")}
            disabled
            className="h-4 w-4 mt-0.5 border-border accent-foreground"
          />
          <span>
            <span className="text-foreground">Adyen</span>
            <span className="block text-xs text-muted-foreground">Coming soon.</span>
          </span>
        </label>
      </div>
    </div>
  );
}

// Coerce schedule on save: when the user toggles override on but never edits, send the default
// schedule. When toggled off, send null. When all days are empty, treat as "no override" too —
// otherwise the override would block all bookings outright, which we never want as a side effect
// of clicking the radio.
function serialiseOverride(s: Schedule | null): Schedule | null {
  if (!s) return null;
  const allEmpty = (Object.keys(s) as (keyof Schedule)[]).every((k) => s[k].length === 0);
  if (allEmpty) return null;
  return coerceSchedule(s);
}
