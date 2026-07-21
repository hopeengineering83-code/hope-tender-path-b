// Tenders list — Pipeline stages bucket reconciliation.
//
// tender.stage is a free-form String column (prisma/schema.prisma), not a
// Prisma enum. app/api/tenders/[id]/ai-rematch/route.ts writes
// stage: "COMPLIANCE" on real tenders, which is not one of the six literal
// stage names (TENDER_INTAKE, ANALYSIS_COMPLETE, PLAN_CONFIRMED,
// DOCUMENTS_GENERATED, EXPORT_READY, EXPORTED) the tenders list page's
// "Pipeline stages" strip buckets against. Confirmed live against a seeded
// PostgreSQL instance: of 4 tenders, 3 had stage values ("INTAKE",
// "COMPLIANCE", "APPROVAL") that did not exactly match any of the six
// buckets, so the strip showed "Intake: 1" while the page's own "4 total"
// header sat directly above it — the bucket counts silently summed to less
// than the total.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const src = read("app/dashboard/tenders/page.tsx");

describe("Tenders list — Pipeline stages bucket reconciliation", () => {
  it("computes classifiedCount and otherCount so unclassified stages are never silently dropped", () => {
    assert.match(src, /const classifiedCount = STAGE_ORDER\.reduce\(\(sum, s\) => sum \+ stageCounts\[s\], 0\)/);
    assert.match(src, /const otherCount = allTenders\.length - classifiedCount/);
  });

  it("renders an 'Other' bucket chip when otherCount > 0", () => {
    assert.match(src, /\{otherCount > 0 && \(/);
    assert.match(src, />Other</);
    assert.match(src, /\{otherCount\}/);
  });

  it("app/api/tenders/[id]/ai-rematch/route.ts's stage: \"COMPLIANCE\" write is a confirmed real-world case this must not drop", () => {
    const rematchSrc = read("app/api/tenders/[id]/ai-rematch/route.ts");
    assert.match(rematchSrc, /stage:\s*"COMPLIANCE"/);
    // STAGE_ORDER must not silently gain a matching entry for it — the fix
    // is the Other bucket, not reclassifying COMPLIANCE into one of the six
    // canonical pipeline stages (that would assert an unverified semantic
    // equivalence between the compliance-review workflow and the document
    // pipeline).
    const stageOrderMatch = src.match(/const STAGE_ORDER = \[([\s\S]*?)\] as const/);
    assert.ok(stageOrderMatch, "STAGE_ORDER array literal must be found");
    assert.doesNotMatch(stageOrderMatch![1], /"COMPLIANCE"/);
  });
});
