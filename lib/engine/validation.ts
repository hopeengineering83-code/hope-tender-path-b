import { prisma } from "../prisma";

export async function validateTenderForSubmission(tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: { orderBy: { exactOrder: "asc" } },
      complianceGaps: true,
      generatedDocuments: { orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  const issues: string[] = [];
  const warnings: string[] = [];

  const blockingGaps = tender.complianceGaps.filter(
    (gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity),
  );
  if (blockingGaps.length > 0) {
    issues.push(`${blockingGaps.length} blocking compliance gap(s) remain unresolved.`);
  }

  if (tender.generatedDocuments.length === 0) {
    issues.push("No generated documents are available.");
  }

  const missingFiles = tender.generatedDocuments.filter((doc) => !doc.storagePath);
  if (missingFiles.length > 0) {
    issues.push(`${missingFiles.length} planned document(s) have not been generated into files yet.`);
  }

  const requiredNamedDocs = tender.requirements
    .filter((req) => Boolean(req.exactFileName))
    .map((req) => req.exactFileName as string);

  for (const exactName of requiredNamedDocs) {
    const found = tender.generatedDocuments.some(
      (doc) => (doc.exactFileName || doc.name).toLowerCase() === exactName.toLowerCase(),
    );
    if (!found) {
      issues.push(`Required file name missing from generated outputs: ${exactName}.`);
    }
  }

  const requiredOrders = tender.requirements
    .filter((req) => req.exactOrder !== null)
    .map((req) => req.exactOrder as number)
    .sort((a, b) => a - b);

  const generatedOrders = tender.generatedDocuments
    .filter((doc) => doc.exactOrder !== null)
    .map((doc) => doc.exactOrder as number)
    .sort((a, b) => a - b);

  if (requiredOrders.length > 0 && JSON.stringify(requiredOrders) !== JSON.stringify(generatedOrders.slice(0, requiredOrders.length))) {
    warnings.push("Generated document order does not fully match all tender requirement order entries.");
  }

  const unresolvedInformationalGaps = tender.complianceGaps.filter(
    (gap) => !gap.isResolved && !["CRITICAL", "HIGH"].includes(gap.severity),
  );
  if (unresolvedInformationalGaps.length > 0) {
    warnings.push(`${unresolvedInformationalGaps.length} lower-severity gap(s) still need review.`);
  }

  const validationPassed = issues.length === 0;

  await prisma.generatedDocument.updateMany({
    where: { tenderId: tender.id },
    data: {
      validationStatus: validationPassed ? "PASSED" : "FAILED",
      generationStatus: validationPassed ? "VALIDATED" : undefined,
    },
  });

  await prisma.tender.update({
    where: { id: tender.id },
    data: {
      status: validationPassed ? "READY_FOR_GENERATION" : tender.status,
      stage: validationPassed ? "REVIEW" : tender.stage,
    },
  });

  return {
    tenderId: tender.id,
    validationPassed,
    issues,
    warnings,
    blockingGapCount: blockingGaps.length,
    generatedDocumentCount: tender.generatedDocuments.length,
  };
}
