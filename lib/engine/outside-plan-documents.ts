import type { PrismaClient } from "@prisma/client";
import { getCurrentConfirmedBuildPlan, type BuildPlanItem } from "./build-plan";

/**
 * Which generated documents the confirmed submission plan does not name.
 *
 * This lived inline in the supersede-outside-plan route, and the automatic
 * pipeline had no way to reach it. The export gate blocks on outside-plan
 * documents with the recommended action "supersede or remove them before final
 * export", while the Submission Plan panel tells the owner the opposite — that
 * such a document "is excluded from the package automatically. No action is
 * needed". Both statements were in the product; only the blocking one was true,
 * because nothing on the automatic path excluded anything.
 *
 * That mattered on the ordinary path, not an exotic one. Generation writes an
 * expert CV per matched expert, and a tender whose plan names three files gets
 * a fourth document it never asked for — after which AUTO_FINALIZE could not
 * produce a package and the owner had no automatic route to one.
 *
 * The rule now lives in one place and both callers use it, so the manual
 * control and the automatic stage cannot decide "outside the plan" differently.
 */

const normalizeExactFileName = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

export type OutsidePlanDocuments = {
  ids: string[];
  /**
   * True when there is no confirmed plan to compare against. Nothing is
   * outside a plan that does not exist, and superseding on that basis would
   * discard every generated document.
   */
  planEmpty: boolean;
};

export async function findOutsidePlanDocumentIds(
  client: Pick<PrismaClient, "tender">,
  input: { tenderId: string; userId: string },
): Promise<OutsidePlanDocuments> {
  const tender = await client.tender.findFirst({
    where: { id: input.tenderId, userId: input.userId },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true },
      },
    },
  });
  if (!tender) return { ids: [], planEmpty: false };

  const confirmedPlan = await getCurrentConfirmedBuildPlan(
    client as PrismaClient,
    input.tenderId,
    input.userId,
  );
  const planItems: BuildPlanItem[] = confirmedPlan.ok ? confirmedPlan.items : [];
  if (planItems.length === 0) return { ids: [], planEmpty: true };

  const required = new Set(
    planItems.map((item) => normalizeExactFileName(item.exactFileName ?? "")).filter(Boolean),
  );
  const ids = tender.generatedDocuments
    .filter((doc) => !required.has(normalizeExactFileName(doc.exactFileName ?? doc.name ?? "")))
    .map((doc) => doc.id);

  return { ids, planEmpty: false };
}

/**
 * Mark the named documents as superseded.
 *
 * Nothing is deleted: the rows stay, carrying the reason, exactly as the manual
 * control has always left them. The package simply stops containing a file the
 * tender never asked for.
 */
export async function supersedeOutsidePlanDocuments(
  client: Pick<PrismaClient, "generatedDocument">,
  input: { tenderId: string; documentIds: string[] },
): Promise<number> {
  if (input.documentIds.length === 0) return 0;
  const result = await client.generatedDocument.updateMany({
    where: { id: { in: input.documentIds }, tenderId: input.tenderId },
    data: {
      generationStatus: "SUPERSEDED",
      validationStatus: "SUPERSEDED",
      reviewStatus: "NOT_EXPORTABLE",
      reviewNotes: "Superseded as outside submission plan.",
    },
  });
  return result.count;
}
