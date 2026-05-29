"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { type IntakeField, validateIntakeFieldDefinitions } from "@/lib/intake";
import { IntakeFieldsEditor } from "@/components/intake-fields-editor";
import {
  WorkingHoursEditor,
  coerceSchedule,
  defaultSchedule,
  type Schedule,
} from "@/components/working-hours-editor";

import { PaymentMethodPicker, type PaymentMethod } from "@/app/dashboard/meeting-types/form";

type ConferencingProvider =
  | "GOOGLE_MEET"
  | "ZOOM"
  | "TEAMS"
  | "IN_PERSON"
  | "PERSONAL_ZOOM_ROOM"
  | "PERSONAL_TEAMS_ROOM"
  | "NONE";
type RoutingMode = "SINGLE" | "ROUND_ROBIN" | "COLLECTIVE";
type Fairness = "LEAST_RECENTLY_ASSIGNED" | "LEAST_LOADED" | "STRICT_ROTATION" | "RANDOM";

const FAIRNESS_DESCRIPTIONS: Record<Fairness, string> = {
  LEAST_RECENTLY_ASSIGNED:
    "Whoever hasn't taken a booking longest gets the next one. Fair across vacations and schedules.",
  LEAST_LOADED: "Host with the fewest upcoming bookings gets it.",
  STRICT_ROTATION: "Pure A → B → C order, regardless of load.",
  RANDOM: "Random pick from the team.",
};

interface ProjectMember {
  hostId: string;
  name: string;
  email: string;
  isExternal: boolean;
  hasZoom: boolean;
  hasStripe: boolean;
  hasPersonalZoomRoom: boolean;
  hasPersonalTeamsRoom: boolean;
  calendars: { id: string; summary: string; role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET" }[];
}

const SUPPORTED_CURRENCIES = ["eur", "usd", "gbp"] as const;

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
  routingMode: RoutingMode;
  roundRobinFairness: Fairness;
  assignedHostIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
  conferencingHostId: string | null;
  defaultLocation: string | null;
  maxInvitees: number;
  workingHoursOverride: Schedule | null;
  priceCents: number | null;
  priceCurrency: string | null;
  paymentMethod: PaymentMethod;
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
  routingMode: RoutingMode;
  roundRobinFairness: Fairness;
  assignedHostIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
  conferencingHostId: string | null;
  defaultLocation: string;
  maxInvitees: number;
  workingHoursOverride: Schedule | null;
  isPaid: boolean;
  priceMajor: string;
  priceCurrency: string;
  paymentMethod: PaymentMethod;
}

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
    routingMode: initial.routingMode,
    roundRobinFairness: initial.roundRobinFairness,
    assignedHostIds: initial.assignedHostIds,
    intakeFields: initial.intakeFields,
    isActive: initial.isActive,
    conferencingProvider: initial.conferencingProvider,
    // Legacy collective MTs predate the per-MT conferencing host. Default to the first
    // assigned host so the form's validation matches what the UI shows.
    conferencingHostId:
      initial.conferencingHostId ??
      (initial.routingMode === "COLLECTIVE" && initial.conferencingProvider !== "NONE"
        ? initial.assignedHostIds[0] ?? null
        : null),
    defaultLocation: initial.defaultLocation ?? "",
    maxInvitees: initial.maxInvitees,
    workingHoursOverride: initial.workingHoursOverride,
    isPaid,
    priceMajor: isPaid && initial.priceCents != null ? (initial.priceCents / 100).toString() : "",
    priceCurrency: initial.priceCurrency ?? "eur",
    paymentMethod: initial.paymentMethod,
  };
}

function pricingPayload(draft: DraftValues):
  | { priceCents: number; priceCurrency: string }
  | { priceCents: null; priceCurrency: null } {
  if (!draft.isPaid) return { priceCents: null, priceCurrency: null };
  const major = Number(draft.priceMajor);
  if (!Number.isFinite(major) || major <= 0) return { priceCents: null, priceCurrency: null };
  return {
    priceCents: Math.round(major * 100),
    priceCurrency: draft.priceCurrency,
  };
}

export function ProjectMeetingTypeForm({
  projectId,
  projectSlug,
  members,
  initial,
}: {
  projectId: string;
  projectSlug: string;
  members: ProjectMember[];
  initial?: Initial;
}) {
  const isEdit = Boolean(initial);
  if (isEdit && initial) {
    return (
      <EditProjectMeetingTypeForm
        projectId={projectId}
        projectSlug={projectSlug}
        members={members}
        initial={initial}
      />
    );
  }
  return (
    <CreateProjectMeetingTypeForm
      projectId={projectId}
      projectSlug={projectSlug}
      members={members}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Edit (direct-edit pattern)
// ────────────────────────────────────────────────────────────

function EditProjectMeetingTypeForm({
  projectId,
  projectSlug,
  members,
  initial,
}: {
  projectId: string;
  projectSlug: string;
  members: ProjectMember[];
  initial: Initial;
}) {
  const router = useRouter();
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<DraftValues>(initialToDraft(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTabKey>("basics");
  const [tabErrors, setTabErrors] = useState<ProjectTabError[]>([]);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft({ ...draft, [key]: value });
  }

  const singleHostId = draft.routingMode === "SINGLE" ? draft.assignedHostIds[0] : undefined;
  const activeHostCalendars = members.find((m) => m.hostId === singleHostId)?.calendars ?? [];

  function setSingleAssignedHost(hostId: string) {
    const host = members.find((m) => m.hostId === hostId);
    const validIds = new Set((host?.calendars ?? []).map((c) => c.id));
    setDraft({
      ...draft,
      assignedHostIds: [hostId],
      conflictCalendarIds: draft.conflictCalendarIds.filter((id: string) => validIds.has(id)),
    });
  }

  function toggleAssignedHost(hostId: string, on: boolean) {
    const set = new Set(draft.assignedHostIds);
    if (on) set.add(hostId);
    else set.delete(hostId);
    const nextIds = [...set];
    const nextConfHost =
      draft.routingMode === "COLLECTIVE"
        ? draft.conferencingHostId && nextIds.includes(draft.conferencingHostId)
          ? draft.conferencingHostId
          : nextIds[0] ?? null
        : draft.conferencingHostId;
    setDraft({ ...draft, assignedHostIds: nextIds, conferencingHostId: nextConfHost });
  }

  function setRoutingMode(mode: RoutingMode) {
    const nextAssigned: string[] =
      mode === "SINGLE"
        ? draft.assignedHostIds.slice(0, 1).length > 0
          ? [draft.assignedHostIds[0]]
          : members[0]?.hostId
            ? [members[0].hostId]
            : []
        : draft.assignedHostIds;
    const nextConfHost =
      mode === "COLLECTIVE"
        ? draft.conferencingHostId && nextAssigned.includes(draft.conferencingHostId)
          ? draft.conferencingHostId
          : nextAssigned[0] ?? null
        : null;
    setDraft({
      ...draft,
      routingMode: mode,
      assignedHostIds: nextAssigned,
      conferencingHostId: nextConfHost,
      conflictCalendarIds: mode === "SINGLE" ? draft.conflictCalendarIds : [],
    });
  }

  function discard() {
    setError(null);
    setTabErrors([]);
    reset();
  }

  function save() {
    setError(null);
    const errors = validateProjectDraft(draft, members);
    if (errors.length > 0) {
      setTabErrors(errors);
      const firstWithError = PROJECT_TAB_ORDER.find((t) =>
        errors.some((e) => e.tabKey === t),
      );
      if (firstWithError) setActiveTab(firstWithError);
      setError(errors[0].message);
      return;
    }
    setTabErrors([]);
    const overridePayload = serialiseOverride(draft.workingHoursOverride);
    const pricing = pricingPayload(draft);

    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types/${initial.id}`, {
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
          routingMode: draft.routingMode,
          roundRobinFairness: draft.roundRobinFairness,
          assignedHostIds: draft.assignedHostIds,
          intakeFields: draft.intakeFields,
          isActive: draft.isActive,
          conferencingProvider: draft.conferencingProvider,
          conferencingHostId: draft.routingMode === "COLLECTIVE" ? draft.conferencingHostId : null,
          defaultLocation:
            draft.conferencingProvider === "IN_PERSON"
              ? draft.defaultLocation.trim()
              : null,
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
      commit({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
      router.refresh();
    });
  }

  async function destroy() {
    if (!confirm("Delete this meeting type? Existing bookings stay; the public link will 404.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types/${initial.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.text()) || "Failed to delete");
        return;
      }
      router.push(`/dashboard/projects/${projectSlug}`);
      router.refresh();
    });
  }

  const errorCount = (key: ProjectTabKey) =>
    tabErrors.filter((e) => e.tabKey === key).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit meeting type"
        description={`Booking link: /${projectSlug}/${draft.slug || initial.slug}`}
        actions={<SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />}
      />
      <DirtyNavGuard dirty={dirty} onSave={save} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProjectTabKey)}>
        <TabsList>
          <TabsTrigger value="basics" errorCount={errorCount("basics")}>
            Basics
          </TabsTrigger>
          <TabsTrigger value="routing" errorCount={errorCount("routing")}>
            Routing
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
              <CardDescription>Name, slug, duration, and description.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProjectBasicsEditor
                draft={draft}
                update={update}
                onNameChange={(v) => update("name", v)}
                onSlugChange={(v) => update("slug", v.toLowerCase())}
                projectSlug={projectSlug}
                isEdit
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routing">
          <Card>
            <CardHeader>
              <CardTitle>Routing</CardTitle>
              <CardDescription>How bookings are assigned across project members.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProjectRoutingEditor
                draft={draft}
                update={update}
                setSingleAssignedHost={setSingleAssignedHost}
                toggleAssignedHost={toggleAssignedHost}
                setRoutingMode={setRoutingMode}
                members={members}
              />
            </CardContent>
          </Card>

          {draft.routingMode === "ROUND_ROBIN" && (
            <Card>
              <CardHeader>
                <CardTitle>Fairness</CardTitle>
                <CardDescription>
                  How round-robin picks among free assigned hosts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FairnessEditor draft={draft} update={update} />
              </CardContent>
            </Card>
          )}

          {draft.routingMode === "SINGLE" && (
            <Card>
              <CardHeader>
                <CardTitle>Group bookings</CardTitle>
                <CardDescription>
                  How many invitees can claim the same time slot. 1 keeps it 1:1.
                </CardDescription>
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
          )}
        </TabsContent>

        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
              <CardDescription>
                Defaults to each assigned host&apos;s working hours. Override here when this meeting type
                only happens at specific times — applies to every assigned host.
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
              <CardDescription>
                Where the meeting happens. Zoom requires every assigned host to have connected it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectConferencingEditor
                draft={draft}
                update={update}
                members={members}
                hideHostPicker
              />
            </CardContent>
          </Card>

          {draft.routingMode === "SINGLE" && (
            <Card>
              <CardHeader>
                <CardTitle>Conflict calendars</CardTitle>
                <CardDescription>
                  Which of the assigned host&apos;s calendars block this meeting type. Default uses every
                  conflict-source they configured.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConflictCalendarsEditor
                  draft={draft}
                  update={update}
                  hostCalendars={activeHostCalendars}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pricing">
          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
              <CardDescription>
                Charge invitees through Stripe Checkout before the booking is confirmed. Each booking host
                must have Stripe connected under their own Settings → Payments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectPricingEditor draft={draft} update={update} members={members} />
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

function CreateProjectMeetingTypeForm({
  projectId,
  projectSlug,
  members,
}: {
  projectId: string;
  projectSlug: string;
  members: ProjectMember[];
}) {
  const router = useRouter();
  const draftDefault: DraftValues = {
    name: "",
    slug: "",
    description: "",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 60,
    maxAdvanceDays: 60,
    conflictCalendarIds: [],
    routingMode: "SINGLE",
    roundRobinFairness: "LEAST_RECENTLY_ASSIGNED",
    assignedHostIds: members[0]?.hostId ? [members[0].hostId] : [],
    intakeFields: [],
    isActive: true,
    conferencingProvider: "GOOGLE_MEET",
    conferencingHostId: null,
    defaultLocation: "",
    maxInvitees: 1,
    workingHoursOverride: null,
    isPaid: false,
    priceMajor: "",
    priceCurrency: "eur",
    paymentMethod: "STRIPE",
  };

  const [draft, setDraft] = useState<DraftValues>(draftDefault);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const singleHostId = draft.routingMode === "SINGLE" ? draft.assignedHostIds[0] : undefined;
  const activeHostCalendars = members.find((m) => m.hostId === singleHostId)?.calendars ?? [];

  function setSingleAssignedHost(hostId: string) {
    const host = members.find((m) => m.hostId === hostId);
    const validIds = new Set((host?.calendars ?? []).map((c) => c.id));
    setDraft((prev) => ({
      ...prev,
      assignedHostIds: [hostId],
      conflictCalendarIds: prev.conflictCalendarIds.filter((id) => validIds.has(id)),
    }));
  }

  function toggleAssignedHost(hostId: string, on: boolean) {
    setDraft((prev) => {
      const set = new Set(prev.assignedHostIds);
      if (on) set.add(hostId);
      else set.delete(hostId);
      const nextIds = [...set];
      const nextConfHost =
        prev.routingMode === "COLLECTIVE"
          ? prev.conferencingHostId && nextIds.includes(prev.conferencingHostId)
            ? prev.conferencingHostId
            : nextIds[0] ?? null
          : prev.conferencingHostId;
      return { ...prev, assignedHostIds: nextIds, conferencingHostId: nextConfHost };
    });
  }

  function setRoutingMode(mode: RoutingMode) {
    setDraft((prev) => {
      const nextAssigned: string[] =
        mode === "SINGLE"
          ? prev.assignedHostIds.slice(0, 1).length > 0
            ? [prev.assignedHostIds[0]]
            : members[0]?.hostId
              ? [members[0].hostId]
              : []
          : prev.assignedHostIds;
      const nextConfHost =
        mode === "COLLECTIVE"
          ? prev.conferencingHostId && nextAssigned.includes(prev.conferencingHostId)
            ? prev.conferencingHostId
            : nextAssigned[0] ?? null
          : null;
      return {
        ...prev,
        routingMode: mode,
        assignedHostIds: nextAssigned,
        conferencingHostId: nextConfHost,
        conflictCalendarIds: mode === "SINGLE" ? prev.conflictCalendarIds : [],
      };
    });
  }

  function handleNameChange(value: string) {
    update("name", value);
    if (!slugTouched) update("slug", autoSlug(value));
  }

  function cancel() {
    router.push(`/dashboard/projects/${projectSlug}`);
  }

  function submit() {
    setError(null);
    const validation = validateDraft(draft, members);
    if (validation) return setError(validation);
    const overridePayload = serialiseOverride(draft.workingHoursOverride);
    const pricing = pricingPayload(draft);

    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types`, {
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
          routingMode: draft.routingMode,
          roundRobinFairness: draft.roundRobinFairness,
          assignedHostIds: draft.assignedHostIds,
          intakeFields: draft.intakeFields,
          isActive: draft.isActive,
          conferencingProvider: draft.conferencingProvider,
          conferencingHostId: draft.routingMode === "COLLECTIVE" ? draft.conferencingHostId : null,
          defaultLocation:
            draft.conferencingProvider === "IN_PERSON"
              ? draft.defaultLocation.trim()
              : null,
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
      router.push(`/dashboard/projects/${projectSlug}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name, slug, duration, and assigned host.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailsEditor
            draft={draft}
            update={update}
            onNameChange={handleNameChange}
            onSlugChange={(v) => {
              update("slug", v.toLowerCase());
              setSlugTouched(true);
            }}
            setSingleAssignedHost={setSingleAssignedHost}
            toggleAssignedHost={toggleAssignedHost}
            setRoutingMode={setRoutingMode}
            members={members}
            projectSlug={projectSlug}
            isEdit={false}
          />
        </CardContent>
      </Card>

      {draft.routingMode === "ROUND_ROBIN" && (
        <Card>
          <CardHeader>
            <CardTitle>Fairness</CardTitle>
            <CardDescription>How round-robin picks among free assigned hosts.</CardDescription>
          </CardHeader>
          <CardContent>
            <FairnessEditor draft={draft} update={update} />
          </CardContent>
        </Card>
      )}

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
            Defaults to each assigned host&apos;s working hours. Override here when this meeting type
            only happens at specific times — applies to every assigned host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Group bookings</CardTitle>
          <CardDescription>
            How many invitees can claim the same time slot. 1 keeps it 1:1. Only available with single-host routing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {draft.routingMode !== "SINGLE" ? (
            <p className="text-sm text-muted-foreground">
              Group bookings are only available with single-host routing.
            </p>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conferencing</CardTitle>
          <CardDescription>
            Where the meeting happens. Zoom requires every assigned host to have connected it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectConferencingEditor draft={draft} update={update} members={members} />
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
            Charge invitees through Stripe Checkout before the booking is confirmed. Each booking host
            must have Stripe connected under their own Settings → Payments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectPricingEditor draft={draft} update={update} members={members} />
        </CardContent>
      </Card>

      {draft.routingMode === "SINGLE" && (
        <Card>
          <CardHeader>
            <CardTitle>Conflict calendars</CardTitle>
            <CardDescription>
              Which of the assigned host&apos;s calendars block this meeting type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={activeHostCalendars} />
          </CardContent>
        </Card>
      )}

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
// Validation
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// Tab-aware validation (project MT)
// ────────────────────────────────────────────────────────────

type ProjectTabKey =
  | "basics"
  | "routing"
  | "availability"
  | "conferencing"
  | "pricing"
  | "intake";

const PROJECT_TAB_ORDER: ProjectTabKey[] = [
  "basics",
  "routing",
  "availability",
  "conferencing",
  "pricing",
  "intake",
];

interface ProjectTabError {
  tabKey: ProjectTabKey;
  message: string;
}

function validateProjectDraft(
  draft: DraftValues,
  members: ProjectMember[],
): ProjectTabError[] {
  const errors: ProjectTabError[] = [];
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
  if (draft.routingMode === "SINGLE") {
    const id = draft.assignedHostIds[0];
    if (!id || !members.some((m) => m.hostId === id)) {
      errors.push({
        tabKey: "routing",
        message: "Pick an assigned host from the project members.",
      });
    }
  } else {
    const label = draft.routingMode === "COLLECTIVE" ? "Collective" : "Round-robin";
    if (draft.assignedHostIds.length < 2) {
      errors.push({
        tabKey: "routing",
        message: `${label} needs at least two assigned hosts.`,
      });
    }
    const allValid = draft.assignedHostIds.every((id) =>
      members.some((m) => m.hostId === id),
    );
    if (!allValid) {
      errors.push({
        tabKey: "routing",
        message: "All assigned hosts must be project members.",
      });
    }
  }
  if (
    !Number.isInteger(draft.maxInvitees) ||
    draft.maxInvitees < 1 ||
    draft.maxInvitees > 50
  ) {
    errors.push({
      tabKey: "routing",
      message: "Max invitees must be a whole number between 1 and 50.",
    });
  }
  if (draft.maxInvitees > 1 && draft.routingMode !== "SINGLE") {
    errors.push({
      tabKey: "routing",
      message: "Group meetings (max invitees > 1) only work with single-host routing.",
    });
  }
  if (draft.conferencingProvider === "IN_PERSON") {
    if (draft.defaultLocation.trim().length === 0) {
      errors.push({
        tabKey: "conferencing",
        message: "Enter a default location for in-person meetings.",
      });
    } else if (draft.defaultLocation.length > 500) {
      errors.push({
        tabKey: "conferencing",
        message: "Default location is too long (max 500 characters).",
      });
    }
  }
  if (draft.conferencingProvider === "ZOOM") {
    if (draft.routingMode === "COLLECTIVE") {
      const confId = draft.conferencingHostId;
      if (!confId || !draft.assignedHostIds.includes(confId)) {
        errors.push({
          tabKey: "routing",
          message: "Pick a conferencing host from the assigned hosts.",
        });
      } else {
        const confMember = members.find((m) => m.hostId === confId);
        if (!confMember?.hasZoom) {
          errors.push({
            tabKey: "conferencing",
            message: `${confMember?.name ?? "The conferencing host"} hasn't connected Zoom yet.`,
          });
        }
      }
    } else {
      const missing = draft.assignedHostIds
        .map((id) => members.find((m) => m.hostId === id))
        .filter((m): m is ProjectMember => Boolean(m && !m.hasZoom));
      if (missing.length > 0) {
        errors.push({
          tabKey: "conferencing",
          message: `These assigned hosts haven't connected Zoom: ${missing
            .map((m) => m.name)
            .join(", ")}. They need to connect in Settings → Connections first.`,
        });
      }
    }
  }
  // PERSONAL_ZOOM_ROOM / PERSONAL_TEAMS_ROOM: each booking hands the picked host's stored URL to
  // the invitee. Same shape as Zoom — COLLECTIVE checks the conferencing host only;
  // SINGLE/ROUND_ROBIN checks every assigned host (each booking uses the booker's own room).
  if (
    draft.conferencingProvider === "PERSONAL_ZOOM_ROOM" ||
    draft.conferencingProvider === "PERSONAL_TEAMS_ROOM"
  ) {
    const isZoom = draft.conferencingProvider === "PERSONAL_ZOOM_ROOM";
    const has = (m: ProjectMember) => (isZoom ? m.hasPersonalZoomRoom : m.hasPersonalTeamsRoom);
    const label = isZoom ? "Zoom" : "Teams";
    if (draft.routingMode === "COLLECTIVE") {
      const confId = draft.conferencingHostId;
      if (!confId || !draft.assignedHostIds.includes(confId)) {
        errors.push({
          tabKey: "routing",
          message: "Pick a conferencing host from the assigned hosts.",
        });
      } else {
        const confMember = members.find((m) => m.hostId === confId);
        if (!confMember || !has(confMember)) {
          errors.push({
            tabKey: "conferencing",
            message: `${confMember?.name ?? "The conferencing host"} hasn't set a personal ${label} room URL on their profile.`,
          });
        }
      }
    } else {
      const missing = draft.assignedHostIds
        .map((id) => members.find((m) => m.hostId === id))
        .filter((m): m is ProjectMember => Boolean(m && !has(m)));
      if (missing.length > 0) {
        errors.push({
          tabKey: "conferencing",
          message: `These assigned hosts haven't set a personal ${label} room URL: ${missing
            .map((m) => m.name)
            .join(", ")}.`,
        });
      }
    }
  }
  if (
    draft.routingMode === "COLLECTIVE" &&
    draft.conferencingProvider !== "NONE" &&
    draft.conferencingProvider !== "IN_PERSON" &&
    !draft.conferencingHostId
  ) {
    errors.push({
      tabKey: "routing",
      message: "Pick a conferencing host from the assigned hosts.",
    });
  }
  if (draft.isPaid) {
    const major = Number(draft.priceMajor);
    if (!Number.isFinite(major) || major <= 0) {
      errors.push({ tabKey: "pricing", message: "Enter a price greater than 0." });
    } else if (draft.paymentMethod === "STRIPE" && Math.round(major * 100) < 50) {
      errors.push({
        tabKey: "pricing",
        message: "Stripe requires a minimum charge of 0.50.",
      });
    }
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(draft.priceCurrency)) {
      errors.push({ tabKey: "pricing", message: "Pick a currency." });
    }
    // Stripe-account requirement only applies when actually using Stripe. INVOICE rail has no
    // such constraint — the host invoices manually outside the app.
    if (draft.paymentMethod === "STRIPE") {
      if (draft.routingMode === "COLLECTIVE") {
        const confHost = members.find((m) => m.hostId === draft.conferencingHostId);
        if (!confHost?.hasStripe) {
          errors.push({
            tabKey: "pricing",
            message: `${confHost?.name ?? "The conferencing host"} hasn't connected Stripe under Settings → Payments.`,
          });
        }
      } else {
        const missing = draft.assignedHostIds
          .map((id) => members.find((m) => m.hostId === id))
          .filter((m): m is ProjectMember => Boolean(m && !m.hasStripe));
        if (missing.length > 0) {
          errors.push({
            tabKey: "pricing",
            message: `These assigned hosts haven't connected Stripe: ${missing.map((m) => m.name).join(", ")}. Connect under Settings → Payments first.`,
          });
        }
      }
    }
  }
  const intakeErr = validateIntakeFieldDefinitions(draft.intakeFields);
  if (intakeErr) {
    errors.push({ tabKey: "intake", message: intakeErr.message });
  }
  return errors;
}

function validateDraft(draft: DraftValues, members: ProjectMember[]): string | null {
  if (draft.name.trim().length < 2) return "Name is required.";
  if (!SLUG_RE.test(draft.slug)) return "Slug must be 2–40 chars, lowercase letters/digits/hyphens.";
  if (![15, 30, 45, 60, 90, 120].includes(draft.durationMinutes)) {
    return "Duration must be 15, 30, 45, 60, 90, or 120 minutes.";
  }
  if (draft.routingMode === "SINGLE") {
    const id = draft.assignedHostIds[0];
    if (!id || !members.some((m) => m.hostId === id)) {
      return "Pick an assigned host from the project members.";
    }
  } else {
    const label = draft.routingMode === "COLLECTIVE" ? "Collective" : "Round-robin";
    if (draft.assignedHostIds.length < 2) {
      return `${label} needs at least two assigned hosts.`;
    }
    const allValid = draft.assignedHostIds.every((id) => members.some((m) => m.hostId === id));
    if (!allValid) return "All assigned hosts must be project members.";
  }
  if (!Number.isInteger(draft.maxInvitees) || draft.maxInvitees < 1 || draft.maxInvitees > 50) {
    return "Max invitees must be a whole number between 1 and 50.";
  }
  if (draft.maxInvitees > 1 && draft.routingMode !== "SINGLE") {
    return "Group meetings (max invitees > 1) only work with single-host routing.";
  }
  if (draft.conferencingProvider === "ZOOM") {
    if (draft.routingMode === "COLLECTIVE") {
      const confId = draft.conferencingHostId;
      if (!confId || !draft.assignedHostIds.includes(confId)) {
        return "Pick a conferencing host from the assigned hosts.";
      }
      const confMember = members.find((m) => m.hostId === confId);
      if (!confMember?.hasZoom) {
        return `${confMember?.name ?? "The conferencing host"} hasn't connected Zoom yet.`;
      }
    } else {
      // SINGLE / ROUND_ROBIN: every booking host needs Zoom (each booking uses their own).
      const missing = draft.assignedHostIds
        .map((id) => members.find((m) => m.hostId === id))
        .filter((m): m is ProjectMember => Boolean(m && !m.hasZoom));
      if (missing.length > 0) {
        return `These assigned hosts haven't connected Zoom: ${missing
          .map((m) => m.name)
          .join(", ")}. They need to connect in Settings → Connections first.`;
      }
    }
  }
  if (
    draft.routingMode === "COLLECTIVE" &&
    draft.conferencingProvider !== "NONE" &&
    draft.conferencingProvider !== "IN_PERSON" &&
    !draft.conferencingHostId
  ) {
    return "Pick a conferencing host from the assigned hosts.";
  }
  if (draft.conferencingProvider === "IN_PERSON" && draft.defaultLocation.trim().length === 0) {
    return "Enter a default location for in-person meetings.";
  }
  if (
    draft.conferencingProvider === "PERSONAL_ZOOM_ROOM" ||
    draft.conferencingProvider === "PERSONAL_TEAMS_ROOM"
  ) {
    const isZoom = draft.conferencingProvider === "PERSONAL_ZOOM_ROOM";
    const has = (m: ProjectMember) => (isZoom ? m.hasPersonalZoomRoom : m.hasPersonalTeamsRoom);
    const label = isZoom ? "Zoom" : "Teams";
    if (draft.routingMode === "COLLECTIVE") {
      const confId = draft.conferencingHostId;
      if (!confId || !draft.assignedHostIds.includes(confId)) {
        return "Pick a conferencing host from the assigned hosts.";
      }
      const confMember = members.find((m) => m.hostId === confId);
      if (!confMember || !has(confMember)) {
        return `${confMember?.name ?? "The conferencing host"} hasn't set a personal ${label} room URL on their profile.`;
      }
    } else {
      const missing = draft.assignedHostIds
        .map((id) => members.find((m) => m.hostId === id))
        .filter((m): m is ProjectMember => Boolean(m && !has(m)));
      if (missing.length > 0) {
        return `These assigned hosts haven't set a personal ${label} room URL: ${missing.map((m) => m.name).join(", ")}.`;
      }
    }
  }

  // Pricing — every host that could be the booking host needs Stripe connected:
  //   SINGLE/ROUND_ROBIN: every assigned host. COLLECTIVE: the conferencing host.
  if (draft.isPaid) {
    const major = Number(draft.priceMajor);
    if (!Number.isFinite(major) || major <= 0) return "Enter a price greater than 0.";
    if (draft.paymentMethod === "STRIPE" && Math.round(major * 100) < 50) {
      return "Stripe requires a minimum charge of 0.50.";
    }
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(draft.priceCurrency)) {
      return "Pick a currency.";
    }
    if (draft.paymentMethod === "STRIPE") {
      if (draft.routingMode === "COLLECTIVE") {
        const confHost = members.find((m) => m.hostId === draft.conferencingHostId);
        if (!confHost?.hasStripe) {
          return `${confHost?.name ?? "The conferencing host"} hasn't connected Stripe under Settings → Payments.`;
        }
      } else {
        const missing = draft.assignedHostIds
          .map((id) => members.find((m) => m.hostId === id))
          .filter((m): m is ProjectMember => Boolean(m && !m.hasStripe));
        if (missing.length > 0) {
          return `These assigned hosts haven't connected Stripe: ${missing.map((m) => m.name).join(", ")}. Connect under Settings → Payments first.`;
        }
      }
    }
  }
  const intakeErr = validateIntakeFieldDefinitions(draft.intakeFields);
  if (intakeErr) return intakeErr.message;
  return null;
}

// ────────────────────────────────────────────────────────────
// Shared editors
// ────────────────────────────────────────────────────────────

function DetailsEditor({
  draft,
  update,
  onNameChange,
  onSlugChange,
  setSingleAssignedHost,
  toggleAssignedHost,
  setRoutingMode,
  members,
  projectSlug,
  isEdit,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  setSingleAssignedHost: (hostId: string) => void;
  toggleAssignedHost: (hostId: string, on: boolean) => void;
  setRoutingMode: (mode: RoutingMode) => void;
  members: ProjectMember[];
  projectSlug: string;
  isEdit: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={draft.name} onChange={(e) => onNameChange(e.target.value)} placeholder="Project kickoff" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/{projectSlug}/</span>
          <Input id="slug" value={draft.slug} onChange={(e) => onSlugChange(e.target.value)} placeholder="kickoff" />
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
        <Label htmlFor="routingMode">Routing</Label>
        <Select
          id="routingMode"
          value={draft.routingMode}
          onChange={(e) => setRoutingMode(e.target.value as RoutingMode)}
        >
          <option value="SINGLE">Single host — one specific person</option>
          <option value="ROUND_ROBIN">Round-robin — least-recently-booked host gets the slot</option>
          <option value="COLLECTIVE">Collective — all assigned hosts attend together</option>
        </Select>
      </div>

      {draft.routingMode === "SINGLE" ? (
        <div className="space-y-1.5">
          <Label htmlFor="assignedHost">Assigned host</Label>
          <Select
            id="assignedHost"
            value={draft.assignedHostIds[0] ?? ""}
            onChange={(e) => setSingleAssignedHost(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.hostId} value={m.hostId}>
                {m.name} — {m.email}
                {m.isExternal ? " (external)" : ""}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>
            Assigned hosts (pick at least 2)
            {draft.routingMode === "COLLECTIVE" && (
              <span className="ml-1 text-xs text-muted-foreground">— all attend every meeting</span>
            )}
          </Label>
          <ul className="rounded-md border border-border divide-y divide-border">
            {members.map((m) => {
              const checked = draft.assignedHostIds.includes(m.hostId);
              return (
                <li key={m.hostId} className="flex items-center justify-between gap-3 p-3">
                  <label className="flex items-center gap-2 text-sm flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleAssignedHost(m.hostId, e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-foreground shrink-0"
                    />
                    <span className="truncate text-foreground">
                      {m.name} <span className="text-muted-foreground">— {m.email}</span>
                      {m.isExternal && (
                        <span className="ml-1 text-xs uppercase tracking-wide text-subtle-foreground">
                          external
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {draft.routingMode === "COLLECTIVE"
              ? "A slot is offered only when every selected host is free; the booking adds all of them as attendees."
              : "A slot is offered when any selected host is free; we assign the least-recently-booked one."}
          </p>
        </div>
      )}
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

function ProjectBasicsEditor({
  draft,
  update,
  onNameChange,
  onSlugChange,
  projectSlug,
  isEdit,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  projectSlug: string;
  isEdit: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={draft.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Project kickoff"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/{projectSlug}/</span>
          <Input
            id="slug"
            value={draft.slug}
            onChange={(e) => onSlugChange(e.target.value)}
            placeholder="kickoff"
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

function ProjectRoutingEditor({
  draft,
  update,
  setSingleAssignedHost,
  toggleAssignedHost,
  setRoutingMode,
  members,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  setSingleAssignedHost: (hostId: string) => void;
  toggleAssignedHost: (hostId: string, on: boolean) => void;
  setRoutingMode: (mode: RoutingMode) => void;
  members: ProjectMember[];
}) {
  const isCollective = draft.routingMode === "COLLECTIVE";
  const showConfHostPicker = isCollective && draft.conferencingProvider !== "NONE";
  const assigned = draft.assignedHostIds
    .map((id) => members.find((m) => m.hostId === id))
    .filter((m): m is ProjectMember => Boolean(m));
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="routingMode">Routing</Label>
        <Select
          id="routingMode"
          value={draft.routingMode}
          onChange={(e) => setRoutingMode(e.target.value as RoutingMode)}
        >
          <option value="SINGLE">Single host — one specific person</option>
          <option value="ROUND_ROBIN">Round-robin — least-recently-booked host gets the slot</option>
          <option value="COLLECTIVE">Collective — all assigned hosts attend together</option>
        </Select>
      </div>

      {draft.routingMode === "SINGLE" ? (
        <div className="space-y-1.5">
          <Label htmlFor="assignedHost">Assigned host</Label>
          <Select
            id="assignedHost"
            value={draft.assignedHostIds[0] ?? ""}
            onChange={(e) => setSingleAssignedHost(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.hostId} value={m.hostId}>
                {m.name} — {m.email}
                {m.isExternal ? " (external)" : ""}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>
            Assigned hosts (pick at least 2)
            {isCollective && (
              <span className="ml-1 text-xs text-muted-foreground">— all attend every meeting</span>
            )}
          </Label>
          <ul className="rounded-md border border-border divide-y divide-border">
            {members.map((m) => {
              const checked = draft.assignedHostIds.includes(m.hostId);
              return (
                <li key={m.hostId} className="flex items-center justify-between gap-3 p-3">
                  <label className="flex items-center gap-2 text-sm flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleAssignedHost(m.hostId, e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-foreground shrink-0"
                    />
                    <span className="truncate text-foreground">
                      {m.name} <span className="text-muted-foreground">— {m.email}</span>
                      {m.isExternal && (
                        <span className="ml-1 text-xs uppercase tracking-wide text-subtle-foreground">
                          external
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {isCollective
              ? "A slot is offered only when every selected host is free; the booking adds all of them as attendees."
              : "A slot is offered when any selected host is free; we assign the least-recently-booked one."}
          </p>
        </div>
      )}

      {showConfHostPicker && (
        <div className="space-y-1.5">
          <Label htmlFor="conferencingHost">Conferencing host</Label>
          <Select
            id="conferencingHost"
            value={draft.conferencingHostId ?? ""}
            onChange={(e) => update("conferencingHostId", e.target.value || null)}
          >
            {assigned.length === 0 && <option value="">— pick assigned hosts first —</option>}
            {assigned.map((m) => (
              <option key={m.hostId} value={m.hostId}>
                {m.name} — {m.email}
                {draft.conferencingProvider === "ZOOM" && !m.hasZoom ? " (no Zoom)" : ""}
              </option>
            ))}
          </Select>
          {draft.conferencingProvider === "ZOOM" && (
            <p className="text-xs text-muted-foreground">
              Only this host needs Zoom connected. Others will be added as alternative hosts where
              possible, otherwise as guests.
            </p>
          )}
          {draft.conferencingProvider === "GOOGLE_MEET" && (
            <p className="text-xs text-muted-foreground">
              The Meet link is created on this host&apos;s calendar. Other assigned hosts join as
              attendees.
            </p>
          )}
        </div>
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

function FairnessEditor({
  draft,
  update,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="roundRobinFairness">Fairness rule</Label>
      <Select
        id="roundRobinFairness"
        value={draft.roundRobinFairness}
        onChange={(e) => update("roundRobinFairness", e.target.value as Fairness)}
      >
        <option value="LEAST_RECENTLY_ASSIGNED">Least recently assigned</option>
        <option value="LEAST_LOADED">Least loaded</option>
        <option value="STRICT_ROTATION">Strict rotation</option>
        <option value="RANDOM">Random</option>
      </Select>
      <p className="text-xs text-muted-foreground">
        {FAIRNESS_DESCRIPTIONS[draft.roundRobinFairness]}
      </p>
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
            name="projectAvailabilityMode"
            checked={!overrideOn}
            onChange={() => toggleOverride(false)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Use each host&apos;s default working hours
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="projectAvailabilityMode"
            checked={overrideOn}
            onChange={() => toggleOverride(true)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Custom for this meeting type (applied in each host&apos;s timezone)
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
  hostCalendars: ProjectMember["calendars"];
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

  if (hostCalendars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The assigned host hasn&apos;t finished onboarding their calendars yet — defaults will apply once they do.
      </p>
    );
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

function ProjectConferencingEditor({
  draft,
  update,
  members,
  hideHostPicker = false,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  members: ProjectMember[];
  // The Edit form moves the conferencing-host picker into the Routing tab; in that case
  // this provider editor should render the provider select only.
  hideHostPicker?: boolean;
}) {
  const assigned = draft.assignedHostIds.map((id) => members.find((m) => m.hostId === id)).filter(Boolean) as ProjectMember[];
  const isCollective = draft.routingMode === "COLLECTIVE";
  // IN_PERSON makes the conferencing host irrelevant — no online meeting is created so there's
  // no host account to pick. Hide the picker for IN_PERSON the same way we do for NONE.
  const showPicker =
    isCollective &&
    draft.conferencingProvider !== "NONE" &&
    draft.conferencingProvider !== "IN_PERSON" &&
    !hideHostPicker;
  // For COLLECTIVE only the conferencing host needs Zoom; otherwise every assigned host does.
  const confHost = isCollective
    ? assigned.find((m) => m.hostId === draft.conferencingHostId)
    : undefined;
  const missingZoom =
    draft.conferencingProvider === "ZOOM"
      ? isCollective
        ? confHost && !confHost.hasZoom
          ? [confHost]
          : []
        : assigned.filter((m) => !m.hasZoom)
      : [];
  const anyAssignedHasZoom = assigned.some((m) => m.hasZoom);
  const zoomDisabled = isCollective ? !anyAssignedHasZoom : !assigned.every((m) => m.hasZoom);
  const zoomLabel = isCollective
    ? anyAssignedHasZoom
      ? ""
      : " — at least one assigned host must connect Zoom first"
    : zoomDisabled
      ? " — every assigned host must connect Zoom first"
      : "";

  // PERSONAL_ZOOM_ROOM / PERSONAL_TEAMS_ROOM: COLLECTIVE needs *some* assigned host to have one
  // set (the conferencing host pick narrows it later); SINGLE/ROUND_ROBIN needs every assigned
  // host to have one (each booking hands the picked host's URL to the invitee).
  const anyAssignedHasPersonalZoomRoom = assigned.some((m) => m.hasPersonalZoomRoom);
  const personalZoomRoomDisabled = isCollective
    ? !anyAssignedHasPersonalZoomRoom
    : assigned.length === 0 || !assigned.every((m) => m.hasPersonalZoomRoom);
  const personalZoomRoomLabel = isCollective
    ? anyAssignedHasPersonalZoomRoom
      ? ""
      : " — at least one assigned host must set a Zoom room URL first"
    : personalZoomRoomDisabled
      ? " — every assigned host must set a Zoom room URL first"
      : "";
  const anyAssignedHasPersonalTeamsRoom = assigned.some((m) => m.hasPersonalTeamsRoom);
  const personalTeamsRoomDisabled = isCollective
    ? !anyAssignedHasPersonalTeamsRoom
    : assigned.length === 0 || !assigned.every((m) => m.hasPersonalTeamsRoom);
  const personalTeamsRoomLabel = isCollective
    ? anyAssignedHasPersonalTeamsRoom
      ? ""
      : " — at least one assigned host must set a Teams room URL first"
    : personalTeamsRoomDisabled
      ? " — every assigned host must set a Teams room URL first"
      : "";
  const missingPersonalZoomRoom: ProjectMember[] =
    draft.conferencingProvider === "PERSONAL_ZOOM_ROOM"
      ? isCollective
        ? confHost && !confHost.hasPersonalZoomRoom
          ? [confHost]
          : []
        : assigned.filter((m) => !m.hasPersonalZoomRoom)
      : [];
  const missingPersonalTeamsRoom: ProjectMember[] =
    draft.conferencingProvider === "PERSONAL_TEAMS_ROOM"
      ? isCollective
        ? confHost && !confHost.hasPersonalTeamsRoom
          ? [confHost]
          : []
        : assigned.filter((m) => !m.hasPersonalTeamsRoom)
      : [];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="projectConferencingProvider">Provider</Label>
        <Select
          id="projectConferencingProvider"
          value={draft.conferencingProvider}
          onChange={(e) => update("conferencingProvider", e.target.value as ConferencingProvider)}
        >
          <option value="GOOGLE_MEET">Google Meet</option>
          <option value="ZOOM" disabled={zoomDisabled}>
            Zoom{zoomLabel}
          </option>
          <option value="TEAMS" disabled>
            Microsoft Teams — coming later
          </option>
          <option value="IN_PERSON">In person</option>
          <option value="PERSONAL_ZOOM_ROOM" disabled={personalZoomRoomDisabled}>
            Personal Zoom room{personalZoomRoomLabel}
          </option>
          <option value="PERSONAL_TEAMS_ROOM" disabled={personalTeamsRoomDisabled}>
            Personal Teams room{personalTeamsRoomLabel}
          </option>
          <option value="NONE">None (no conferencing link)</option>
        </Select>
      </div>

      {(draft.conferencingProvider === "PERSONAL_ZOOM_ROOM" ||
        draft.conferencingProvider === "PERSONAL_TEAMS_ROOM") && (
        <p className="text-xs text-muted-foreground">
          Each booking hands the picked host&apos;s saved personal room URL to the invitee. Hosts
          set their URL on their <span className="text-foreground">Profile</span> page.
        </p>
      )}

      {draft.conferencingProvider === "IN_PERSON" && (
        <div className="space-y-1.5">
          <Label htmlFor="projectDefaultLocation">Default location</Label>
          <Input
            id="projectDefaultLocation"
            value={draft.defaultLocation}
            onChange={(e) => update("defaultLocation", e.target.value)}
            placeholder="e.g. Soul Studio, Herengracht 1, Amsterdam — entrance via the canal side"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            Shown on the booking page and added to the calendar event. No online link is generated.
            All assigned hosts attend at this location.
          </p>
        </div>
      )}

      {showPicker && (
        <div className="space-y-1.5">
          <Label htmlFor="conferencingHost">Conferencing host</Label>
          <Select
            id="conferencingHost"
            value={draft.conferencingHostId ?? ""}
            onChange={(e) => update("conferencingHostId", e.target.value || null)}
          >
            {assigned.length === 0 && <option value="">— pick assigned hosts first —</option>}
            {assigned.map((m) => (
              <option key={m.hostId} value={m.hostId}>
                {m.name} — {m.email}
                {draft.conferencingProvider === "ZOOM" && !m.hasZoom ? " (no Zoom)" : ""}
              </option>
            ))}
          </Select>
          {draft.conferencingProvider === "ZOOM" && (
            <p className="text-xs text-muted-foreground">
              Only this host needs Zoom connected. Others will be added as alternative hosts where
              possible, otherwise as guests.
            </p>
          )}
          {draft.conferencingProvider === "GOOGLE_MEET" && (
            <p className="text-xs text-muted-foreground">
              The Meet link is created on this host&apos;s calendar. Other assigned hosts join as
              attendees.
            </p>
          )}
          {(draft.conferencingProvider === "PERSONAL_ZOOM_ROOM" ||
            draft.conferencingProvider === "PERSONAL_TEAMS_ROOM") && (
            <p className="text-xs text-muted-foreground">
              The booking hands this host&apos;s saved personal room URL to the invitee. Other
              assigned hosts join as attendees on the calendar invite.
            </p>
          )}
        </div>
      )}

      {missingZoom.length > 0 && (
        <p className="text-xs text-destructive">
          {missingZoom.map((m) => m.name).join(", ")} {missingZoom.length === 1 ? "hasn't" : "haven't"} connected Zoom yet.
        </p>
      )}
      {missingPersonalZoomRoom.length > 0 && (
        <p className="text-xs text-destructive">
          {missingPersonalZoomRoom.map((m) => m.name).join(", ")}{" "}
          {missingPersonalZoomRoom.length === 1 ? "hasn't" : "haven't"} set a personal Zoom room URL yet.
        </p>
      )}
      {missingPersonalTeamsRoom.length > 0 && (
        <p className="text-xs text-destructive">
          {missingPersonalTeamsRoom.map((m) => m.name).join(", ")}{" "}
          {missingPersonalTeamsRoom.length === 1 ? "hasn't" : "haven't"} set a personal Teams room URL yet.
        </p>
      )}
    </div>
  );
}

function ProjectPricingEditor({
  draft,
  update,
  members,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  members: ProjectMember[];
}) {
  // Required-Stripe set depends on routing: COLLECTIVE → conferencing host only;
  // SINGLE/ROUND_ROBIN → every assigned host.
  const required: ProjectMember[] =
    draft.routingMode === "COLLECTIVE"
      ? members.filter((m) => m.hostId === draft.conferencingHostId)
      : draft.assignedHostIds
          .map((id) => members.find((m) => m.hostId === id))
          .filter((m): m is ProjectMember => Boolean(m));
  const missing = required.filter((m) => !m.hasStripe);

  return (
    <div className="space-y-3">
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="projectPricingMode"
            checked={!draft.isPaid}
            onChange={() => update("isPaid", false)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Free
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="projectPricingMode"
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
            <Label htmlFor="projectPriceMajor">Amount</Label>
            <Input
              id="projectPriceMajor"
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
            <Label htmlFor="projectPriceCurrency">Currency</Label>
            <Select
              id="projectPriceCurrency"
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
      {draft.isPaid && draft.paymentMethod === "STRIPE" && missing.length > 0 && (
        <p className="text-xs text-destructive">
          {missing.map((m) => m.name).join(", ")} {missing.length === 1 ? "hasn't" : "haven't"} connected
          Stripe. Each booking host needs to connect under their own Settings → Payments first.
        </p>
      )}
    </div>
  );
}

function serialiseOverride(s: Schedule | null): Schedule | null {
  if (!s) return null;
  const allEmpty = (Object.keys(s) as (keyof Schedule)[]).every((k) => s[k].length === 0);
  if (allEmpty) return null;
  return coerceSchedule(s);
}
