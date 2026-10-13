// Findings from the release review of PR #1175 (automated review of 0301eaa0,
// 2026-10-11), each confirmed against the code before it was changed.
//
// - A required price form whose wording the financial reader does not list
//   ("Price Bid Form") was dropped from the Build Plan.
// - A planned "Pricing Form.xlsx" was not recognised as a price submission, so
//   the pricing panel said a financial proposal was not required.
// - A plural "certificates" (registration, tax clearance) added a checklist
//   item for the experts' professional licences.
// - The checklist could not name an administrative envelope.
// - A Vault PDF named "declaration" or "power of attorney" — signed for some
//   other procurement — was bound into this tender's combined file.
//
// Second review (19ea981f):
// - With a rate the tender fixes, budget scaling was computed over the whole
//   subtotal but applied only to the other lines, so the offer stayed above
//   the client's ceiling.
// - Running generation or auto-finalize again appended a second signature and
//   stamp to every generated DOCX.
// - Auto-finalize reported EXPORT_READY from the byte gate alone while the
//   canonical resolver still blocked final export (pinned in
//   tests/preview-panel-canonical-action-regression.test.ts).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";
import { isPriceSubmissionFile, resolvePricingScope } from "../lib/engine/pricing-submission-scope";
import { buildOwnerAttachmentChecklist } from "../lib/engine/owner-attachment-checklist";
import { tenderAnnexPolicy } from "../lib/engine/annex-policy";
import { vaultCandidatesForKind } from "../lib/engine/annex-bundle";
import { estimateTenderPrice, type PricingEvidenceInput } from "../lib/engine/pricing-intelligence";
import { insertImageIntoDocx } from "../lib/engine/apply-signature-stamp";
import JSZip from "jszip";

type Row = { id: string; title: string; description: string; requirementType: string; priority: string; exactFileName?: string | null };
const row = (id: string, title: string, description: string, requirementType = "SUBMISSION_RULE", extra: Partial<Row> = {}): Row =>
  ({ id, title, description, requirementType, priority: "MANDATORY", ...extra });
const planOf = (requirements: Row[]) => buildSubmissionPlan({ id: "t", requirements } as never);
const emptyChecklistInput = { declaredFileNames: [] as string[], vaultDocuments: [], selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [] as string[] };

describe("a price form the tender requires stays in the plan", () => {
  const technical = row("r1", "Technical Proposal", "Submit a technical proposal.", "TECHNICAL", { exactFileName: "Technical Proposal.pdf" });
  const priceBid = row("r2", "Price Bid Form", "Complete and sign the price bid form.", "FORM");

  it("whatever words the tender uses for it", () => {
    const names = planOf([technical, priceBid]).files.map((f) => f.exactFileName);
    assert.ok(names.some((n) => /price bid form/i.test(n)), names.join(", "));
  });
  it("and leaves it only when the tender rules pricing out", () => {
    const names = planOf([technical, priceBid, row("r3", "Pricing", "Bidders shall not submit prices with this proposal.")]).files.map((f) => f.exactFileName);
    assert.ok(!names.some((n) => /price bid form/i.test(n)), names.join(", "));
  });
});

describe("a tender-named pricing document activates pricing", () => {
  it("Pricing Form, Price Sheet, Cost Schedule and Rate Schedule are price submissions", () => {
    for (const name of ["Pricing Form.xlsx", "Price Sheet.xlsx", "Cost Schedule.docx", "Rate Schedule.xlsx", "Financial Form.docx"]) {
      assert.equal(isPriceSubmissionFile(name, "TENDER_REQUIRED_FILE"), true, name);
    }
    assert.equal(isPriceSubmissionFile("Financial Capacity Form.docx", "FORM"), false);
    assert.equal(isPriceSubmissionFile("Audited Financial Statements.pdf", "TENDER_REQUIRED_FILE"), false);
  });
  it("the pricing scope reads it from the confirmed plan", () => {
    const scope = resolvePricingScope({ confirmedPlanItems: [{ exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL" }, { exactFileName: "Pricing Form.xlsx", documentType: "TENDER_REQUIRED_FILE" }], tenderText: "" });
    assert.equal(scope.required, true);
  });
});

describe("the experts' professional credentials are listed only when the tender asks for them", () => {
  const PROFESSIONAL = "Professional licences and certificates of the proposed experts";
  it("the firm's registration and tax certificates are not the experts' licences", () => {
    const rows = [row("r1", "Legal documents", "Attach copies of the business registration certificates and tax clearance certificates.")];
    const list = buildOwnerAttachmentChecklist({ requirements: rows, ...emptyChecklistInput });
    assert.ok(!list.items.some((i) => i.kind === PROFESSIONAL), list.items.map((i) => i.kind).join(", "));
    assert.ok(!tenderAnnexPolicy(rows.map((r) => `${r.title} ${r.description}`)).items.includes(PROFESSIONAL));
  });
  it("licences and professional certificates are still read", () => {
    for (const text of [
      "Attach supporting documents such as company profile, professional CVs, licenses and certificates.",
      "Attach the professional certificates of the key experts.",
      "Enclose the engineers' licences.",
    ]) {
      assert.ok(tenderAnnexPolicy([text]).items.includes(PROFESSIONAL), text);
    }
  });
});

describe("an original the tender puts in an administrative envelope goes there", () => {
  it("names the administrative envelope", () => {
    const rows = [row("r1", "Audited Financial Statements", "Audited financial statements for three years shall be enclosed in the administrative envelope.", "FINANCIAL")];
    const item = buildOwnerAttachmentChecklist({ requirements: rows, ...emptyChecklistInput }).items.find((i) => i.kind === "Audited financial statements");
    assert.equal(item?.envelope, "ADMIN");
    assert.match(item?.location ?? "", /^Administrative envelope, as Annex \d$/);
  });
});

describe("a signed original for this tender is never taken from the Vault", () => {
  const vault = [
    { id: "d1", originalFileName: "Signed Declaration.pdf", category: "COMPLIANCE_RECORD", mimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED", contentSha256: "sha-d1" },
    { id: "p1", originalFileName: "Power of Attorney.pdf", category: "LEGAL_REGISTRATION", mimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED", contentSha256: "sha-p1" },
  ];
  const input = { vaultDocuments: vault, selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [] };
  it("declarations and powers of attorney have no Vault candidates", () => {
    assert.deepEqual(vaultCandidatesForKind("Signed declaration form issued with the tender", input), []);
    assert.deepEqual(vaultCandidatesForKind("Power of attorney", input), []);
  });
  it("the combined-file checklist leaves them to the owner and offers no Vault shortcut", () => {
    const rule = row("r1", "Format", "One PDF file named 'Proposal.pdf' containing all annexes. Attach the signed supplier declaration form and a power of attorney.");
    const list = buildOwnerAttachmentChecklist({ requirements: [rule], ...emptyChecklistInput, declaredFileNames: ["Proposal.pdf"], vaultDocuments: vault, boundHashes: ["sha-d1", "sha-p1"] });
    assert.equal(list.mode, "COMBINED_FILE");
    for (const kind of ["Signed declaration form issued with the tender", "Power of attorney"]) {
      const item = list.items.find((i) => i.kind === kind);
      assert.ok(item, kind);
      assert.equal(item!.status, "OWNER_TO_ATTACH", kind);
      assert.doesNotMatch(item!.ownerAction, /Company Vault/, kind);
    }
  });
});

describe("the readiness screens offer only downloads that exist, and pricing opens on its recommendation", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("an envelope link appears only for an envelope with generated documents", () => {
    assert.match(read("components/export-readiness-panel.tsx"), /\(envelopeBreakdown\?\.FINANCIAL \?\? 0\) > 0 &&/);
    assert.match(read("components/owner-attachment-checklist-panel.tsx"), /\(envelopeCounts\.FINANCIAL \?\? 0\) > 0 \?/);
  });
  it("the scenario starts empty so the estimator's recommendation is selected", () => {
    assert.match(read("components/pricing-intelligence-panel.tsx"), /useState<string>\(""\)/);
  });
});

describe("a rate the tender fixes still leaves the offer inside the client's budget", () => {
  const priced = (perDiem: number) => estimateTenderPrice({
    tender: { id: "t1", title: "Feasibility study for rural water supply", country: "Ethiopia", category: "FEASIBILITY_STUDY", currency: null, budget: null },
    tenderText: [
      "The assignment shall be completed within four (4) months from contract signature.",
      "The consultant will conduct fieldwork and household survey data collection in three districts.",
      "Two validation workshops will be held with stakeholders.",
      "The financial proposal shall be in ETB inclusive of 15% VAT.",
      "The total budget for this assignment is ETB 300,000 inclusive of VAT.",
      `Field staff per diem is fixed at ETB ${perDiem.toLocaleString("en-US")} per day.`,
    ].join(" "),
    experts: [
      { id: "e1", name: "A. Leader", title: "Team Leader / WASH Specialist", yearsExperience: 15 },
      { id: "e2", name: "B. Expert", title: "Water Engineer", yearsExperience: 8 },
    ],
    historicalProjects: [],
    priorRates: [],
    companyDefaultCurrency: "USD",
    now: new Date("2026-10-07T00:00:00Z"),
  } as PricingEvidenceInput);

  it("scales only the other lines, into what the fixed lines leave of the ceiling", () => {
    for (const sc of priced(4_000).scenarios) {
      assert.ok(sc.offerTotal <= 300_000, `${sc.id} offers ${sc.offerTotal} against a 300,000 budget`);
      assert.equal(sc.lines.find((l) => /Per diem/.test(l.label))!.rate, 4_000, "the tender's rate is kept");
    }
  });
  it("when the fixed lines leave no room, prices nothing else and says so", () => {
    const est = priced(6_000);
    for (const sc of est.scenarios) {
      assert.equal(sc.complete, false, sc.id);
      for (const l of sc.lines.filter((l) => !/Per diem/.test(l.label))) assert.equal(l.rate, null, `${sc.id} ${l.label}`);
    }
    assert.ok(est.warnings.some((w) => w.code === "BUDGET_EXCEEDED" && /leave no room/.test(w.message)));
  });
});

describe("signature and stamp are applied once, however often generation runs", () => {
  const docx = async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="styles" Target="styles.xml"/></Relationships>`);
    zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p/></w:body></w:document>`);
    return zip.generateAsync({ type: "nodebuffer" });
  };
  const drawings = async (buf: Buffer) => ((await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string")).match(/<w:drawing>/g) ?? []).length;
  const opts = { widthEmu: 1, heightEmu: 1, imageName: "signature_abcd1234" };

  it("a second run adds no second drawing", async () => {
    const once = await insertImageIntoDocx(await docx(), Buffer.from("png-1"), "png", "image/png", opts);
    const twice = await insertImageIntoDocx(once, Buffer.from("png-1"), "png", "image/png", opts);
    assert.equal(await drawings(once), 1);
    assert.equal(await drawings(twice), 1);
    assert.ok(twice.equals(once), "nothing changed, so the document is returned as it was");
  });
  it("a replaced image is swapped in place", async () => {
    const once = await insertImageIntoDocx(await docx(), Buffer.from("png-1"), "png", "image/png", opts);
    const swapped = await insertImageIntoDocx(once, Buffer.from("jpg-2"), "jpg", "image/jpeg", opts);
    const zip = await JSZip.loadAsync(swapped);
    assert.equal(await drawings(swapped), 1);
    assert.equal(zip.file("word/media/signature_abcd1234.png"), null);
    assert.equal(await zip.file("word/media/signature_abcd1234.jpg")!.async("string"), "jpg-2");
    assert.match(await zip.file("word/_rels/document.xml.rels")!.async("string"), /Target="media\/signature_abcd1234\.jpg"/);
    assert.match(await zip.file("[Content_Types].xml")!.async("string"), /Extension="jpg"/);
  });
});
