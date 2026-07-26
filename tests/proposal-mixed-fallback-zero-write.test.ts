// Historical context: the background PROPOSAL_GENERATION handler used to run
// its OWN independent content-generation call (generateProposalSectionsParallel)
// and reject the whole job if ANY section fell back to deterministic content —
// a stricter policy than the interactive /generate route, which has always
// tolerated deterministic fallback (clearly labelled in contentSummary) so a
// human always has something to review.
//
// That bespoke background pipeline only ever persisted raw Markdown labeled
// QUICK_DRAFT/NOT_EXPORTABLE — it could never produce a Final-ZIP-eligible
// document regardless of AI quality. It has been replaced: the handler now
// calls the SAME canonical generateTenderDocuments() pipeline the interactive
// route uses, producing real DOCX with letterhead branding. This harmonizes
// the two paths onto one implementation instead of two competing authorities
// with different (and undocumented) quality policies.
//
// The safety property that matters — a document is never silently
// export-ready — is preserved by the *document* authority model, not by a
// zero-write veto at the job-handler layer: GeneratedDocument.reviewStatus
// defaults to PENDING (prisma/schema.prisma) regardless of whether content
// came from AI or deterministic fallback, and the Final ZIP / export gates
// (lib/engine/final-submission-readiness.ts) require validation + approval
// before export — unaffected by this change. A fallback document is fully
// traceable: generate-elite's contentSummary always starts with the `mode`
// label ("deterministic benchmark fallback..." vs "<provider> ... bid-writer
// ...") and appends "AI fallback reason: <message>" when AI failed, so a
// human reviewer can see exactly what produced the draft.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const handlers = readFileSync("lib/ai-job-handlers.ts", "utf8");
const generateElite = readFileSync("lib/engine/generate-elite.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

function proposalRegion(): string {
  const start = handlers.indexOf("PROPOSAL_GENERATION: async");
  const end = handlers.indexOf("EVALUATOR_SIM:", start);
  assert.ok(start >= 0 && end > start, "proposal handler region must exist");
  return handlers.slice(start, end);
}

describe("proposal generation — single canonical authority (no competing fallback policy)", () => {
  it("the background handler no longer runs its own independent content-generation call", () => {
    const region = proposalRegion();
    assert.doesNotMatch(region, /generateProposalSectionsParallel/, "the bespoke background AI call must be removed — generateTenderDocuments is now the single authority");
    assert.doesNotMatch(region, /anyFallback/, "the handler-local fallback veto is gone; fallback policy now lives in generateTenderDocuments, shared with the interactive route");
  });

  it("the background handler delegates to the same generateTenderDocuments pipeline as the interactive route", () => {
    const region = proposalRegion();
    assert.match(region, /generateTenderDocuments\(ctx\.tenderId, ctx\.userId\)/);
    const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.match(generateRoute, /generateTenderDocuments\(id, userId\)/);
  });

  it("GeneratedDocument.reviewStatus defaults to PENDING regardless of AI vs deterministic-fallback content", () => {
    const modelStart = schema.indexOf("model GeneratedDocument");
    const modelEnd = schema.indexOf("\n}", modelStart);
    const model = schema.slice(modelStart, modelEnd);
    assert.match(model, /reviewStatus\s+String\s+@default\("PENDING"\)/);
  });

  it("generate-elite discloses AI-vs-fallback provenance in the persisted contentSummary", () => {
    assert.match(generateElite, /AI fallback reason:/);
    assert.match(generateElite, /deterministic benchmark fallback/);
    // The summary is built from `mode`, which is set to the fallback label in
    // the catch branch and to the real provider label on the success branch —
    // so contentSummary always tells a reviewer which path produced the draft.
    assert.match(generateElite, /const summary = `\$\{mode\}/);
  });
});
