// 2026-09-23, Preview: a rebuilt Build Plan folded the Cover Letter and
// Company Profile into the single "Technical Proposal.pdf" the tender demands.
// The earlier "Company Profile.docx" stayed GENERATED and the export gate
// reported EXTRA_FILES, because only the manual routes retired outside-plan
// documents — lib/engine/outside-plan-documents.ts claimed the automatic stage
// used the same rule, and it did not.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");

describe("AUTO_FINALIZE retires documents the confirmed plan no longer names", () => {
  const start = source.indexOf("export async function runAutoFinalizeAfterGeneration(");
  const body = source.slice(start);

  it("uses the one shared outside-plan rule, not a local copy", () => {
    assert.match(body, /findOutsidePlanDocumentIds\(prisma, \{ tenderId, userId \}\)/);
    assert.match(body, /supersedeOutsidePlanDocuments\(prisma, \{ tenderId, documentIds: retire \}\)/);
  });

  it("runs before the PDF stage and never against an empty plan", () => {
    const retireAt = body.indexOf("supersedeOutsidePlanDocuments(");
    const pdfAt = body.indexOf("runPdfFinalization(");
    assert.ok(retireAt > 0 && (pdfAt < 0 || retireAt < pdfAt), "retirement must precede PDF finalization");
    assert.match(body, /!outside\.planEmpty/);
  });

  it("protects the source a planned PDF is rendered from", () => {
    assert.match(body, /plannedBases\.has\(baseNameOf\(/);
    const baseNameOf = new Function(`return ${source.slice(source.indexOf("function baseNameOf("))}`.replace(/: string/g, "").replace(/\n}\n[\s\S]*$/, "\n}; return baseNameOf;"))();
    assert.equal(baseNameOf("Technical Proposal.docx"), baseNameOf("Technical Proposal.pdf"));
    assert.notEqual(baseNameOf("Company Profile.docx"), baseNameOf("Technical Proposal.pdf"));
  });
});
