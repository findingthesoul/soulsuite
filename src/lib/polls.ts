import { z } from "zod";
import { randomBytes } from "node:crypto";

// Stored on Poll.proposedSlots as a JSON array. We carry an `id` so vote maps stay stable
// across slot reorders (we never mutate after creation, but cheaper this way).
export interface ProposedSlot {
  id: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
}

// Stored on PollResponse.votes as `{ [slotId]: 'YES' | 'MAYBE' | 'NO' }`.
export const VOTE_VALUES = ["YES", "MAYBE", "NO"] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];
export type VoteMap = Record<string, VoteValue>;

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export const proposedSlotSchema: z.ZodType<ProposedSlot> = z.object({
  id: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export const createPollSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    durationMinutes: z.number().int().refine((v) => (DURATION_OPTIONS as readonly number[]).includes(v)),
    proposedSlots: z.array(proposedSlotSchema).min(2).max(20),
    inviteeEmails: z
      .array(z.string().email().max(200).transform((s) => s.toLowerCase()))
      .min(1)
      .max(50),
    // Defaults to PERSONAL for backwards compat with older clients. PROJECT polls require
    // a projectId; the API double-checks the caller has LEAD role on it.
    scope: z.enum(["PERSONAL", "PROJECT"]).default("PERSONAL"),
    projectId: z.string().min(1).optional(),
    // Owner-notification mode. Defaults to FINAL_ONLY so the historical behaviour (silent
    // until you check the dashboard) only loosens when the user opts in.
    notifyMode: z
      .enum(["FINAL_ONLY", "EVERY_VOTE", "DAILY_DIGEST", "NEVER"])
      .default("FINAL_ONLY")
      .optional(),
  })
  .refine(
    (data) => (data.scope === "PROJECT" ? !!data.projectId : true),
    { message: "projectId is required for PROJECT scope.", path: ["projectId"] },
  );

export const voteSchema = z.record(z.string().min(1), z.enum(VOTE_VALUES));

export function newSlotId(): string {
  return randomBytes(6).toString("base64url");
}

export function newResponseToken(): string {
  return randomBytes(24).toString("base64url");
}

// Aggregate vote counts per slot. Treats missing votes as "no response yet".
export function tallyVotes(
  slots: ProposedSlot[],
  responses: { votes: VoteMap }[],
): Record<string, { yes: number; maybe: number; no: number; pending: number }> {
  const out: Record<string, { yes: number; maybe: number; no: number; pending: number }> = {};
  for (const slot of slots) {
    out[slot.id] = { yes: 0, maybe: 0, no: 0, pending: 0 };
  }
  for (const r of responses) {
    for (const slot of slots) {
      const v = r.votes[slot.id];
      if (v === "YES") out[slot.id].yes++;
      else if (v === "MAYBE") out[slot.id].maybe++;
      else if (v === "NO") out[slot.id].no++;
      else out[slot.id].pending++;
    }
  }
  return out;
}
