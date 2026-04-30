// Server-only helpers for intake-form persistence. Each MeetingType owns its own IntakeForm
// 1:1 in v1 (no reuse across MTs yet — flagged in the backlog).

import { Scope } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { IntakeField } from "@/lib/intake";

interface SyncArgs {
  meetingTypeId: string;
  scope: "PERSONAL" | "PROJECT";
  hostId?: string | null;       // for PERSONAL
  projectId?: string | null;    // for PROJECT
  fields: IntakeField[];
  formName: string;             // we just reuse the MT name
  existingIntakeFormId: string | null;
  tx?: Prisma.TransactionClient;
}

// Upsert (or remove) the IntakeForm row attached to a MeetingType. Returns the new
// intakeFormId to set on the MT (null if no fields).
export async function syncIntakeForm(args: SyncArgs): Promise<string | null> {
  const db = args.tx ?? prisma;

  if (args.fields.length === 0) {
    if (args.existingIntakeFormId) {
      // Detach + delete. We delete because nothing else references this form (1:1 ownership).
      await db.meetingType.update({
        where: { id: args.meetingTypeId },
        data: { intakeFormId: null },
      });
      await db.intakeForm.delete({ where: { id: args.existingIntakeFormId } });
    }
    return null;
  }

  if (args.existingIntakeFormId) {
    await db.intakeForm.update({
      where: { id: args.existingIntakeFormId },
      data: {
        name: args.formName,
        fields: args.fields as unknown as Prisma.InputJsonValue,
      },
    });
    return args.existingIntakeFormId;
  }

  const created = await db.intakeForm.create({
    data: {
      scope: args.scope === "PERSONAL" ? Scope.PERSONAL : Scope.PROJECT,
      hostId: args.scope === "PERSONAL" ? args.hostId ?? null : null,
      projectId: args.scope === "PROJECT" ? args.projectId ?? null : null,
      name: args.formName,
      fields: args.fields as unknown as Prisma.InputJsonValue,
    },
  });
  return created.id;
}
