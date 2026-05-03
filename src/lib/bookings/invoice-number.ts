// Sequential invoice numbering, scoped per workspace per year. Format: INV-{YYYY}-{NNNN}.
// Read-modify-write inside a transaction with an upsert so concurrent allocations don't collide.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function nextInvoiceNumber(
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const counter = await tx.workspaceInvoiceCounter.upsert({
    where: { workspaceId_year: { workspaceId, year } },
    create: { workspaceId, year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return `INV-${year}-${String(counter.lastSeq).padStart(4, "0")}`;
}
