/**
 * The owner does not have to upload originals for the app to finish the
 * proposal. Originals the tender requires are listed in an exact Owner
 * Attachment Checklist; the package then reads
 * "PROPOSAL COMPLETE — OWNER ATTACHMENTS REQUIRED", not a generation failure,
 * and never SUBMISSION_READY until the originals are actually in the package.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildOwnerAttachmentChecklist, copyTypeOf, ownerAttachmentChecklistText } from "../lib/engine/owner-attachment-checklist";
import { isProposalCompleteExceptOwnerAttachments } from "../lib/engine/final-submission-readiness";
import { evaluateAutoFinalizeConvergence } from "../lib/ai-jobs/auto-finalize-continuation-service";

const separateRequirement = {
  id: "r-docs",
  title: "Submission Documents",
  description: "Submit scanned copies of Supplier declaration form, Renewed trade license, and VAT registration certificate before the tender closing.",
  requirementType: "SUBMISSION_RULE",
  priority: "MANDATORY",
  sourcePageNumber: 13,
  sourceExactQuote: "The following documents must be submitted before the set tender closing: • Scanned copy of Supplier declaration form (please refer to the Annex I of this document) • Scanned copy of Renewed trade license and trade registration certificate • Scanned copy of VAT and TIN registration certificate",
};

const textSummary = (id: string, name: string, category: string) => ({
  id, originalFileName: name, category, mimeType: "text/plain", contentMimeType: "text/plain", detectedFormat: "TEXT", integrityStatus: "VERIFIED", contentSha256: `sha-${id}`,
});
const verifiedPdf = (id: string, name: string, category: string) => ({
  id, originalFileName: name, category, mimeType: "application/pdf", contentMimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED", contentSha256: `sha-${id}`,
});

describe("Owner Attachment Checklist", () => {
  it("lists every required original exactly as the tender asks for it", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [separateRequirement],
      declaredFileNames: ["Technical Proposal.docx", "Financial Proposal.docx"],
      vaultDocuments: [textSummary("v1", "02_Legal_Registration_Documents_Summary.docx.txt", "LEGAL_REGISTRATION")],
      selectedExpertSourceDocumentIds: [],
      selectedProjectSourceDocumentIds: [],
      formsAwaitingOriginal: [],
      boundHashes: [],
    });
    assert.equal(list.mode, "SEPARATE_ATTACHMENTS");
    assert.deepEqual(list.items.map((i) => i.kind), [
      "Signed declaration form issued with the tender",
      "Business licence and registration certificates",
      "Tax clearance, VAT and TIN certificates",
    ], "the tender's order");
    const [declaration, licence, tax] = list.items;
    assert.equal(declaration!.copyType, "SCANNED_COPY");
    assert.equal(declaration!.signatureRequired, true, "a declaration is the owner's to sign");
    assert.equal(declaration!.source.page, 13);
    assert.match(declaration!.source.quote ?? "", /Supplier declaration form/);
    assert.match(licence!.document, /trade license/i);
    assert.equal(licence!.vault.status, "HELD_NOT_VERIFIED_PDF", "a text summary is not the original");
    assert.equal(tax!.vault.status, "NOT_IN_VAULT");
    assert.equal(list.outstanding, 3);
    for (const item of list.items) {
      assert.equal(item.status, "OWNER_TO_ATTACH");
      assert.match(item.ownerAction, /^Attach the (?:signed )?scanned copy of /);
      assert.match(item.location, /Technical envelope, as Annex \d after the proposal/);
    }
    const text = ownerAttachmentChecklistText("Feasibility study", list);
    assert.match(text, /Do not submit this list/);
    assert.match(text, /page 13/);
  });

  it("names each document of a list, even when the stored quote was cut short", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [{ ...separateRequirement, sourceExactQuote: "The following documents must be submitted before the set tender closing: • Scanned copy of Supplier declaration form (please refer to the Annex I of this document) • Scanned copy of Renewed trade license and trade registration certificate • Scanned copy of VAT a" }],
      declaredFileNames: [], vaultDocuments: [], selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [],
    });
    assert.deepEqual(list.items.map((i) => i.document), [
      "Scanned copy of Supplier declaration form (please refer to the Annex I of this document)",
      "Scanned copy of Renewed trade license and trade registration certificate",
      "VAT registration certificate",
    ]);
    assert.equal(list.items[2]!.copyType, "SCANNED_COPY", "the copy type of the whole sentence");
    assert.match(list.items[0]!.ownerAction, /^Attach the signed scanned copy of Supplier declaration form/);
  });

  it("for one combined PDF: binds what the Vault holds verified, and names the rest", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [{
        id: "r1", title: "Submission format", requirementType: "SUBMISSION_RULE", priority: "MANDATORY",
        description: "Submit a single electronic PDF file named 'Technical Proposal.pdf' containing all required sections and annexes. Attach supporting documents such as company profile, professional CVs, licenses and certificates.",
      }],
      declaredFileNames: ["Technical Proposal.pdf"],
      vaultDocuments: [verifiedPdf("p1", "Company Profile.pdf", "COMPANY_PROFILE")],
      selectedExpertSourceDocumentIds: [],
      selectedProjectSourceDocumentIds: [],
      formsAwaitingOriginal: [],
      boundHashes: ["sha-p1"],
    });
    assert.equal(list.mode, "COMBINED_FILE");
    assert.equal(list.combinedFileName, "Technical Proposal.pdf");
    const profile = list.items.find((i) => i.kind === "Company profile")!;
    assert.equal(profile.status, "PACKAGED_AUTOMATICALLY");
    assert.match(profile.location, /Inside "Technical Proposal.pdf", after the proposal pages, as Annex 1/);
    const cvs = list.items.find((i) => /Curricula vitae/.test(i.kind))!;
    assert.equal(cvs.status, "OWNER_TO_ATTACH");
    assert.match(cvs.ownerAction, /Insert the .* into "Technical Proposal.pdf" as Annex \d when assembling the file/);
    assert.equal(list.outstanding, list.items.length - 1);
  });

  it("a verified original that is not yet bound is not claimed as packaged", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [{ id: "r1", title: "Format", requirementType: "SUBMISSION_RULE", priority: "MANDATORY", description: "One PDF file named 'Proposal.pdf' containing all annexes. Attach the company profile." }],
      declaredFileNames: ["Proposal.pdf"],
      vaultDocuments: [verifiedPdf("p1", "Company Profile.pdf", "COMPANY_PROFILE")],
      selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [],
    });
    assert.equal(list.items[0]!.status, "OWNER_TO_ATTACH");
    assert.match(list.items[0]!.ownerAction, /bound into "Proposal.pdf" when the package is next finalized/);
  });

  it("lists a tender-issued form the owner signs", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [{ id: "r1", title: "Bid Submission Form", requirementType: "FORM", priority: "MANDATORY", exactFileName: "Form 1 - Bid Submission Form.pdf", sourcePageNumber: 22, sourceExactQuote: "The Bid Submission Form shall be signed and stamped by the authorised representative." }],
      declaredFileNames: [], vaultDocuments: [], selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [],
      formsAwaitingOriginal: [{ fileName: "Form 1 - Bid Submission Form.pdf", documentType: "FORM" }],
      boundHashes: [],
    });
    const form = list.items[0]!;
    assert.equal(form.kind, "Tender-issued form");
    assert.equal(form.signatureRequired, true);
    assert.equal(form.stampRequired, true);
    assert.equal(form.source.page, 22);
    assert.match(form.ownerAction, /Complete and sign the tender's form/);
  });

  it("reads the copy type the tender asks for", () => {
    assert.equal(copyTypeOf("a certified copy of the licence"), "CERTIFIED_COPY");
    assert.equal(copyTypeOf("notarised copies"), "CERTIFIED_COPY");
    assert.equal(copyTypeOf("the original bid security"), "ORIGINAL");
    assert.equal(copyTypeOf("company profile"), "NOT_STATED");
  });
});

describe("Proposal complete vs submission complete", () => {
  const base = { exportReadyCount: 2, formsAwaitingOriginal: ["Form 1.pdf"], plannedFileNames: ["Form 1.pdf"], missingPlanFileNames: ["Form 1.pdf"] };

  it("only owner attachments remain → proposal complete", () => {
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      ...base,
      documentBlockers: [{ name: "Form 1", fileName: "Form 1.pdf" }],
      tenderLevelBlockers: [{ category: "OWNER_ATTACHMENTS_REQUIRED" }, { category: "UNGENERATED_PLANNED_DOCUMENTS" }, { category: "SUBMISSION_PLAN_DOCUMENTS_MISSING" }],
    }), true);
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      ...base, formsAwaitingOriginal: [], plannedFileNames: [], missingPlanFileNames: [],
      documentBlockers: [], tenderLevelBlockers: [{ category: "COMBINED_FILE_ANNEX_MISSING" }],
    }), true);
  });

  it("an unpriced financial proposal, a failed document or another gate keeps it incomplete", () => {
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      ...base, documentBlockers: [{ name: "Financial Proposal", fileName: "Financial Proposal.docx" }], tenderLevelBlockers: [],
    }), false, "pricing is the app's proposal, not an attachment");
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      ...base, documentBlockers: [], tenderLevelBlockers: [{ category: "OWNER_ATTACHMENTS_REQUIRED" }, { category: "CRITICAL_COMPLIANCE_GAPS" }],
    }), false);
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      ...base, plannedFileNames: ["Form 1.pdf", "Financial Proposal.docx"], documentBlockers: [], tenderLevelBlockers: [{ category: "UNGENERATED_PLANNED_DOCUMENTS" }],
    }), false, "a planned app document is still missing");
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      ...base, exportReadyCount: 0, documentBlockers: [], tenderLevelBlockers: [{ category: "OWNER_ATTACHMENTS_REQUIRED" }],
    }), false, "nothing ready is not a complete proposal");
    assert.equal(isProposalCompleteExceptOwnerAttachments({ ...base, documentBlockers: [], tenderLevelBlockers: [] }), false, "with nothing outstanding the status is SUBMISSION_READY, not this");
  });

  it("AUTO_FINALIZE ends complete — not failed — when only owner attachments remain, but still fails for the app's own gaps", () => {
    const run = (overrides: Record<string, unknown>) => evaluateAutoFinalizeConvergence({
      exportRepair: { repaired: 0, skipped: 0, manualRequired: 1, finalExportReady: false },
      sourceRepair: { checked: 0, repaired: 0, remaining: 0 },
      finalReadiness: { evaluated: true, ok: false, proposalComplete: true, ownerAttachmentsOutstanding: 3, documentBlockers: 1, tenderLevelBlockers: 2, categories: [] },
      validation: { validated: 1, failed: 0, pending: 1, rejected: [] },
      pdfFinalization: { finalized: 0, skipped: 0, failed: 0 },
      pdfValidation: { validated: 0, failed: 0, pending: 0, rejected: [] },
      coverageReconciliation: { refreshed: true, requirementsChecked: 3 },
      packageReconciliation: { requiredTotal: 3, missing: 1 },
      missingFileGeneration: { generated: 0, planned: 1, skipped: 0, blocked: null },
      formReuse: { reused: 0, stillMissing: 1 },
      warning: null,
      ...overrides,
    } as never);
    assert.deepEqual(run({}), []);
    assert.equal(run({ sourceRepair: { checked: 3, repaired: 0, remaining: 1 } }).length, 1, "a grounding gap is the app's");
    assert.ok(run({ finalReadiness: { evaluated: true, ok: false, proposalComplete: false, documentBlockers: 1, tenderLevelBlockers: 0, categories: [] } }).length > 0, "an incomplete proposal still fails");
  });
});
