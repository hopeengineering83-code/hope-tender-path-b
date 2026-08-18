/**
 * Run the FINAL critical-metadata evidence validator against a real tender and
 * print exactly which field fails and why.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];

const { validateCriticalMetadataEvidenceForBuildPlan } = await import("../lib/engine/build-plan.ts");

const tender = await p.tender.findFirst({
  where: { id: tenderId },
  include: {
    files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true, originalFileName: true, deletionStatus: true, totalPages: true } },
    metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true, reason: true, confirmationBasis: true, authorityClass: true, confirmedAt: true } },
  },
});

for (const mode of ["draft", "final"]) {
  const v = validateCriticalMetadataEvidenceForBuildPlan(tender, tender.files, tender.metadataOverrides ?? [], mode);
  console.log(`\n=== mode=${mode} ok=${v.ok} ===`);
  for (const b of (v.blockers ?? [])) console.log("  blocker:", typeof b === "string" ? b : JSON.stringify(b));
  for (const b of (v.issues ?? [])) console.log("  issue:", typeof b === "string" ? b : JSON.stringify(b));
  if (v.reasons) for (const b of v.reasons) console.log("  reason:", typeof b === "string" ? b : JSON.stringify(b));
}

console.log("\n--- stored critical fields ---");
for (const k of ["clientName","procuringEntityName","deadline","submissionMethod","submissionEmails","submissionAddress","submissionEmailSubject","reference","title","metadataContaminated"]) {
  console.log(` ${k} =`, JSON.stringify(tender[k]));
}
console.log("\n--- source evidence ---");
for (const k of Object.keys(tender).filter((k) => /SourcePage|SourceQuote|SourceFileId/.test(k)).sort()) {
  const v = tender[k];
  console.log(` ${k} =`, typeof v === "string" ? JSON.stringify(v.slice(0, 70)) : JSON.stringify(v));
}
await p.$disconnect();
