// The finalized PDF must occupy its source's position in the shipped package.
//
// Reproduced defect (live Preview, tender 08e250af, read-only inspect
// 2026-09-10). export-readiness raised, and still raises:
//
//   FILE_ORDER — "Generated file order does not match tender order near:
//                 Technical Proposal.pdf"
//
// exactOrder is not cosmetic. Both places that build the delivered package
// order it the same way:
//
//   lib/engine/final-zip-scope.ts:184
//     sort((a, b) => (a.exactOrder ?? MAX_SAFE_INTEGER) - (b.exactOrder ?? …))
//   app/api/tenders/[id]/export/route.ts:340   — the same expression
//
// So a row with no exactOrder sorts LAST in the ZIP the evaluator opens, not
// merely last in a readiness report.
//
// auto-finalize renders the required PDF from its validated DOCX source and
// writes it with `finalizedPdfData`, which omitted exactOrder entirely. On the
// create path that produced a PDF with no position, while the DOCX it came
// from carried one — live values: Technical Proposal DOCX exactOrder=1,
// finalized Technical Proposal.pdf none. Company Profile.docx therefore took
// position 1 and the primary submission document went last.
//
// The two documents are the same deliverable in two formats. Rendering a
// format must not change where the deliverable sits.
//
// Generic by construction: the position comes from the tender's own confirmed
// plan (or the source row that already carries it), never from a file name,
// document type or sector. The cases below are road, water and EOI packages.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SERVICE = "lib/ai-jobs/auto-finalize-continuation-service.ts";
const src = readFileSync(SERVICE, "utf8");

/** The ordering the ZIP and the export route both apply. */
function packageOrder<T extends { exactFileName: string; exactOrder: number | null }>(docs: T[]): string[] {
  return [...docs]
    .sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER))
    .map((d) => d.exactFileName);
}

/** What auto-finalize now resolves for the finalized PDF. */
function inheritedExactOrder(opts: {
  plannedRow?: { exactOrder: number | null } | null;
  sourceDoc: { exactOrder: number | null };
  existingPdf?: { exactOrder: number | null } | null;
}): number | null {
  return opts.plannedRow?.exactOrder ?? opts.sourceDoc.exactOrder ?? opts.existingPdf?.exactOrder ?? null;
}

describe("finalized PDF inherits its package position", () => {
  it("the write actually carries exactOrder", () => {
    const block = src.slice(src.indexOf("const finalizedPdfData"), src.indexOf("const targetRow"));
    assert.ok(block.length > 0, "finalizedPdfData not found");
    assert.match(block, /exactOrder: inheritedExactOrder/, "finalizedPdfData must write the inherited position");
  });

  it("the rows it inherits from actually select exactOrder", () => {
    // The first attempt at this fix compiled against a query whose select
    // omitted exactOrder; the typechecker caught it. A silently missing field
    // would have made the whole fix a no-op, so pin it.
    // Only the full document-set selects matter — the ones that also pull
    // generationStatus, i.e. the rows finalization reasons over. A narrow
    // `{id, name, exactFileName}` lookup elsewhere (listing
    // REPLACE_WITH_ORIGINAL documents by name) has no ordering role.
    const selects = (src.match(/select:\s*\{[^}]*exactFileName: true[^}]*\}/gs) ?? [])
      .filter((sel) => sel.includes("generationStatus: true"));
    assert.ok(selects.length >= 2, `expected both document-set selects, found ${selects.length}`);
    for (const sel of selects) {
      assert.match(sel, /exactOrder: true/, `a document-set select omits exactOrder:\n${sel.slice(0, 200)}`);
    }
  });

  it("never erases a position it cannot improve", () => {
    // Omitted, not written as null: this can only add ordering information.
    const block = src.slice(src.indexOf("const finalizedPdfData"), src.indexOf("const targetRow"));
    assert.match(
      block,
      /\.\.\.\(inheritedExactOrder != null \? \{ exactOrder: inheritedExactOrder \} : \{\}\)/,
      "a null inherited order must omit the field rather than null out an existing one",
    );
  });

  it("prefers the confirmed plan's position over the source's", () => {
    assert.equal(
      inheritedExactOrder({ plannedRow: { exactOrder: 1 }, sourceDoc: { exactOrder: 7 } }),
      1,
      "the confirmed plan is the ordering authority",
    );
  });

  it("falls back to the DOCX source, then to the existing PDF row", () => {
    assert.equal(inheritedExactOrder({ plannedRow: null, sourceDoc: { exactOrder: 3 } }), 3);
    assert.equal(
      inheritedExactOrder({ plannedRow: null, sourceDoc: { exactOrder: null }, existingPdf: { exactOrder: 5 } }),
      5,
    );
    assert.equal(inheritedExactOrder({ plannedRow: null, sourceDoc: { exactOrder: null } }), null);
  });

  it("the reproduced package now ships in tender order", () => {
    const required = ["Technical Proposal.pdf", "Company Profile.docx"];
    const sourceDocx = { exactFileName: "Technical Proposal.docx", exactOrder: 1 };

    const before = packageOrder([
      { exactFileName: "Technical Proposal.pdf", exactOrder: null },   // the defect
      { exactFileName: "Company Profile.docx", exactOrder: 2 },
    ]);
    assert.deepEqual(before, ["Company Profile.docx", "Technical Proposal.pdf"]);
    assert.notDeepEqual(before, required, "sanity: this is the shipped order that raised FILE_ORDER");

    const after = packageOrder([
      { exactFileName: "Technical Proposal.pdf", exactOrder: inheritedExactOrder({ sourceDoc: sourceDocx }) },
      { exactFileName: "Company Profile.docx", exactOrder: 2 },
    ]);
    assert.deepEqual(after, required, "the finalized PDF must lead the package as the tender requires");
  });

  const CROSS_SECTOR: ReadonlyArray<[string, ReadonlyArray<[string, number]>, string]> = [
    ["road rehabilitation", [["Cover Letter.pdf", 1], ["Technical Proposal.pdf", 2], ["Bill of Quantities.xlsx", 3]], "Technical Proposal.pdf"],
    ["water supply", [["Technical Proposal.pdf", 1], ["Company Profile.docx", 2], ["Audited Accounts.pdf", 3]], "Technical Proposal.pdf"],
    ["EOI consultant selection", [["Expression of Interest.pdf", 1], ["Firm Profile.docx", 2]], "Expression of Interest.pdf"],
  ];
  for (const [sector, plan, finalizedName] of CROSS_SECTOR) {
    it(`${sector}: the rendered PDF keeps its planned slot`, () => {
      const planned = plan.find(([n]) => n === finalizedName)!;
      const docs = plan.map(([exactFileName, exactOrder]) =>
        exactFileName === finalizedName
          ? { exactFileName, exactOrder: inheritedExactOrder({ plannedRow: { exactOrder: planned[1] }, sourceDoc: { exactOrder: null } }) }
          : { exactFileName, exactOrder });
      assert.deepEqual(packageOrder(docs), plan.map(([n]) => n), `${sector} package order drifted`);
    });
  }
});
