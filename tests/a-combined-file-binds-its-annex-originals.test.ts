// A tender whose whole submission is one PDF "containing all required sections
// and annexes" receives one file that actually contains them: the verified
// Company Vault originals, bound after the proposal in the tender's order. The
// app used to deliver only the proposal and list the annexes in a schedule.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { planAnnexBundle, bindAnnexBundle, readAnnexBundleMarker, proposalPagesOnly, annexBundleIdentity, type AnnexVaultDocument } from "../lib/engine/annex-bundle";
import { combinedSubmissionFileName } from "../lib/engine/annex-bundle-loader";
import { generatedDocumentVisibleText } from "../lib/engine/generated-document-text";

async function pdfWith(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines) {
    const page = doc.addPage([595, 842]);
    page.drawText(line, { x: 50, y: 780, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

const vault = (id: string, category: string, originalFileName: string, extra: Partial<AnnexVaultDocument> = {}): AnnexVaultDocument => ({
  id, category, originalFileName, mimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED", contentSha256: `sha-${id}`, ...extra,
});

const ATTACH = "Attach supporting documents such as company profile, professional CVs, business licence and registration certificate, and audited financial statements.";

describe("which originals the combined file binds", () => {
  const input = {
    combinedFileName: "Technical Proposal.pdf",
    requirementTexts: [ATTACH],
    vaultDocuments: [
      vault("profile", "COMPANY_PROFILE", "Company Profile 2026.pdf"),
      vault("cv-selected", "EXPERT_CV", "CV Team Leader.pdf"),
      vault("cv-other", "EXPERT_CV", "CV Unrelated Engineer.pdf"),
      vault("licence", "LEGAL_REGISTRATION", "Business Licence.pdf"),
      vault("licence-copy", "LEGAL_REGISTRATION", "Business Licence (copy).pdf", { contentSha256: "sha-licence" }),
      vault("audit-unverified", "FINANCIAL_STATEMENT", "Audited Statements 2025.pdf", { integrityStatus: "UNKNOWN" }),
    ],
    selectedExpertSourceDocumentIds: ["cv-selected"],
    selectedProjectSourceDocumentIds: [],
  };

  it("binds verified originals in the tender's order, selected experts only, no duplicates", () => {
    const plan = planAnnexBundle(input);
    assert.equal(plan.applies, true);
    assert.deepEqual(plan.parts.map((p) => p.kind), ["Company profile", "Curricula vitae of the proposed experts", "Business licence and registration certificates"]);
    assert.deepEqual(plan.parts.flatMap((p) => p.documents.map((d) => d.id)), ["profile", "cv-selected", "licence"]);
  });

  it("reports an original that is not integrity-verified as missing", () => {
    const plan = planAnnexBundle(input);
    assert.deepEqual(plan.missing.map((m) => m.kind), ["Audited financial statements"]);
    assert.match(plan.missing[0]!.reason, /not as an integrity-verified PDF/);
  });

  it("does nothing when the tender asks for separate attachments", () => {
    assert.equal(planAnnexBundle({ ...input, combinedFileName: null }).applies, false);
    assert.equal(planAnnexBundle({ ...input, combinedFileName: "Technical Proposal.docx" }).applies, false);
  });
});

describe("binding keeps the originals' pages and the proposal's boundary", () => {
  it("appends pages unchanged and records where the proposal ends", async () => {
    const plan = planAnnexBundle({
      combinedFileName: "Technical Proposal.pdf", requirementTexts: [ATTACH],
      vaultDocuments: [vault("profile", "COMPANY_PROFILE", "Company Profile.pdf"), vault("audit", "FINANCIAL_STATEMENT", "Audited Statements.pdf")],
      selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [],
    });
    const originals: Record<string, Buffer> = {
      profile: await pdfWith(["Company profile page one", "Company profile page two"]),
      audit: await pdfWith(["Revenue ETB 48,000,000 Net profit ETB 6,100,000"]),
    };
    const proposal = await pdfWith(["Technical Proposal page one", "Technical Proposal page two"]);
    const result = await bindAnnexBundle(proposal, plan, async (doc) => originals[doc.id] ?? null);

    assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 5);
    assert.equal(result.proposalPages, 2);
    assert.deepEqual(result.bound, annexBundleIdentity(plan));
    assert.deepEqual((await readAnnexBundleMarker(result.bytes))?.bound, annexBundleIdentity(plan));
    assert.equal((await PDFDocument.load(await proposalPagesOnly(result.bytes))).getPageCount(), 2);
  });

  it("validation reads the proposal's own pages, not the bound financial statements", async () => {
    const plan = planAnnexBundle({
      combinedFileName: "Technical Proposal.pdf", requirementTexts: [ATTACH],
      vaultDocuments: [vault("audit", "FINANCIAL_STATEMENT", "Audited Statements.pdf")],
      selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [],
    });
    const merged = await bindAnnexBundle(await pdfWith(["Technical Proposal methodology for the assignment"]), plan,
      async () => pdfWith(["Revenue ETB 48,000,000 Net profit ETB 6,100,000"]));
    const text = await generatedDocumentVisibleText({ fileContent: merged.bytes.toString("base64"), exactFileName: "Technical Proposal.pdf" });
    assert.match(text ?? "", /Technical Proposal methodology/);
    assert.doesNotMatch(text ?? "", /48,000,000/);
  });

  it("an original that cannot be opened is reported, not silently dropped", async () => {
    const plan = planAnnexBundle({
      combinedFileName: "Technical Proposal.pdf", requirementTexts: [ATTACH],
      vaultDocuments: [vault("profile", "COMPANY_PROFILE", "Company Profile.pdf")],
      selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [],
    });
    const result = await bindAnnexBundle(await pdfWith(["Proposal"]), plan, async () => Buffer.from("not a pdf"));
    assert.deepEqual(result.unreadable.map((u) => u.fileName), ["Company Profile.pdf"]);
    assert.deepEqual(result.bound, []);
  });
});

describe("which file is the combined file", () => {
  const req = (description: string) => ({ id: "r", title: "Submission format", description, requirementType: "SUBMISSION_RULE", priority: "MANDATORY" });
  it("a single declared PDF that must contain the annexes", () => {
    assert.equal(combinedSubmissionFileName([req("Submit a single electronic PDF file named 'Technical Proposal.pdf' containing all required sections and annexes.")], ["Technical Proposal.pdf"]), "Technical Proposal.pdf");
  });
  it("not a PDF the tender asks for beside separate attachments", () => {
    assert.equal(combinedSubmissionFileName([req("Submit the technical proposal as a PDF. Attach the CVs as separate files.")], ["Technical Proposal.pdf", "CVs.pdf"]), null);
  });
});
