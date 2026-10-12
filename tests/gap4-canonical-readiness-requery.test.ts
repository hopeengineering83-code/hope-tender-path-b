// Gap 4 contract test: mutation routes re-query canonical final-export authority.
//
// Every mutation route that changes plan state, document state, or evidence
// selection must include `canonicalReadiness` in its success response. The
// client must not have to infer final-export readiness from intermediate
// signals — the authoritative verdict comes from getCanonicalReadinessSummary.
//
// This test scans the source of each mutation route and asserts the
// canonicalReadiness field appears in its success response. It does NOT
// exercise the routes at runtime — that requires a real database. The
// source-scan approach catches regressions where a route is refactored and
// the canonicalReadiness field is dropped.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

type RouteExpectation = {
  file: string;
  /** Short label for the route. */
  label: string;
  /**
   * True iff the route may legitimately omit canonicalReadiness on a no-op
   * success (e.g., reclassify-documents with dryRun=true). The route must
   * still include it on the mutation path.
   */
  allowNullOnNoOp?: boolean;
};

const MUTATION_ROUTES: RouteExpectation[] = [
  { file: "app/api/tenders/[id]/generate/route.ts", label: "POST /api/tenders/:id/generate" },
  { file: "app/api/tenders/[id]/auto-finalize/route.ts", label: "POST /api/tenders/:id/auto-finalize" },
  { file: "app/api/tenders/[id]/repair-export-gaps/route.ts", label: "POST /api/tenders/:id/repair-export-gaps" },
  { file: "app/api/tenders/[id]/generate-missing-plan-files/route.ts", label: "POST /api/tenders/:id/generate-missing-plan-files" },
  { file: "app/api/tenders/[id]/finalize-pdf/route.ts", label: "POST /api/tenders/:id/finalize-pdf" },
  { file: "app/api/tenders/[id]/link-vault-evidence/route.ts", label: "POST /api/tenders/:id/link-vault-evidence" },
  { file: "app/api/tenders/[id]/link-vault-evidence-auto/route.ts", label: "POST /api/tenders/:id/link-vault-evidence-auto" },
  { file: "app/api/tenders/[id]/reclassify-documents/route.ts", label: "POST /api/tenders/:id/reclassify-documents", allowNullOnNoOp: true },
  { file: "app/api/tenders/[id]/documents/[docId]/plan-action/route.ts", label: "POST /api/tenders/:id/documents/:docId/plan-action" },
  { file: "app/api/tenders/[id]/submission-plan/auto-classify/route.ts", label: "POST /api/tenders/:id/submission-plan/auto-classify", allowNullOnNoOp: true },
];

describe("Gap 4 — mutation routes re-query canonical final-export authority", () => {
  for (const route of MUTATION_ROUTES) {
    it(`${route.label} imports getCanonicalReadinessSummary`, () => {
      const src = readFileSync(route.file, "utf8");
      assert.match(
        src,
        /import\s+\{[^}]*getCanonicalReadinessSummary[^}]*\}\s+from\s+["'][^"']*canonical-tender-readiness["']/,
        `${route.file}: must import getCanonicalReadinessSummary from canonical-tender-readiness`,
      );
    });

    it(`${route.label} calls getCanonicalReadinessSummary after the mutation`, () => {
      const src = readFileSync(route.file, "utf8");
      assert.match(
        src,
        /await\s+getCanonicalReadinessSummary\s*\(/,
        `${route.file}: must call await getCanonicalReadinessSummary(...) after the mutation commits`,
      );
    });

    it(`${route.label} includes canonicalReadiness in the success response`, () => {
      const src = readFileSync(route.file, "utf8");
      assert.match(
        src,
        /canonicalReadiness/,
        `${route.file}: success response must include the canonicalReadiness field`,
      );
    });
  }

  it("canonical-tender-readiness exports getCanonicalReadinessSummary", () => {
    const src = readFileSync("lib/canonical-tender-readiness.ts", "utf8");
    assert.match(src, /export async function getCanonicalReadinessSummary/);
    assert.match(src, /export type CanonicalReadinessSummary/);
  });

  it("CanonicalReadinessSummary has the 5 essential fields", () => {
    const src = readFileSync("lib/canonical-tender-readiness.ts", "utf8");
    assert.match(src, /readyForFinalExport:\s*boolean/);
    assert.match(src, /readyForFullProposal:\s*boolean/);
    assert.match(src, /readyForSupportPackage:\s*boolean/);
    assert.match(src, /blockers:\s*string\[\]/);
    assert.match(src, /nextActions:\s*string\[\]/);
  });
});
