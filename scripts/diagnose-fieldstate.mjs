/**
 * Evaluate resolveCanonicalFieldState for a real tender and print each field's
 * state plus the generation/export blocker flags.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const mod = await import("../lib/engine/canonical-field-state.ts").catch(() => null);
const resolverMod = mod ?? await import("../lib/engine/effective-tender-facts.ts").catch(() => null);
const { resolveCanonicalFieldState } = resolverMod ?? {};
if (!resolveCanonicalFieldState) {
  const g = await import("../lib/engine/generation-readiness-gate.ts");
  console.log("resolver not found in expected modules; exports:", Object.keys(g).slice(0, 40));
  process.exit(1);
}

const tender = await p.tender.findUnique({ where: { id: tenderId }, include: { files: true, metadataOverrides: true } });
const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");

const res = resolveCanonicalFieldState({
  tender: { ...tender, metadataContaminated: tender.metadataContaminated ?? false },
  overrides: (tender.metadataOverrides ?? []).map((o) => ({ ...o })),
  hasExtractedRequirements: true,
  submissionMethodContext: tender.submissionMethod ?? undefined,
  activeTenderFileIds: new Set(activeFiles.map((f) => f.id)),
  activeFiles: activeFiles.map((f) => ({ id: f.id, extractedText: f.extractedText, totalPages: f.totalPages ?? null })),
});

console.log("hasGenerationBlocker:", res.hasGenerationBlocker);
console.log("hasExportBlocker    :", res.hasExportBlocker);
console.log("top-level keys      :", Object.keys(res));
const list = res.fields ?? res.fieldStates ?? [];
for (const f of list) {
  if (f && (f.blocksExport || f.blocksGeneration || f.state !== "SOURCE_GROUNDED")) {
    console.log("  " + JSON.stringify(f));
  }
}
await p.$disconnect();
