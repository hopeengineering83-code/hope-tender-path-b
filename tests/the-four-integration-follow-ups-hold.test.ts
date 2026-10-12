// The four follow-ups left after PR #1175 merged into integration (Codex
// review of 0b0a4181, plus the tender-detail validity extractor noted in the
// closure). The pure halves are here; the password-reset and
// extraction-quality halves run on PostgreSQL in
// tests/the-four-integration-follow-ups-db.test.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { planAnnexBundle, fileNamedForExpert, type AnnexVaultDocument } from "../lib/engine/annex-bundle";
import { buildOwnerAttachmentChecklist } from "../lib/engine/owner-attachment-checklist";
import { extractValidityDays } from "../lib/engine/tender-field-extractors";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";
import { estimateTenderPrice } from "../lib/engine/pricing-intelligence";
import { validityBelongsToSecurity } from "../lib/engine/validity-subject";

const CERTIFICATES = "Professional licences and certificates of the proposed experts";
const vault = (id: string, category: string, originalFileName: string): AnnexVaultDocument => ({
  id, category, originalFileName, mimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED", contentSha256: `sha-${id}`,
});

describe("1. a separately stored certificate counts for the selected expert", () => {
  const ATTACH = "Attach supporting documents: company profile, professional CVs, and the professional licences and certificates of the proposed experts.";
  const input = {
    combinedFileName: "Technical Proposal.pdf",
    requirementTexts: [ATTACH],
    vaultDocuments: [
      vault("profile", "COMPANY_PROFILE", "Company Profile.pdf"),
      vault("cv-abebe", "EXPERT_CV", "CV Abebe Kebede.pdf"),
      vault("cert-abebe", "CERTIFICATION", "Abebe_Kebede_PE_Licence.pdf"),
      vault("cert-other", "CERTIFICATION", "Selam Haile licence.pdf"),
    ],
    selectedExpertSourceDocumentIds: ["cv-abebe"],
    selectedProjectSourceDocumentIds: [],
    selectedExpertNames: ["Eng. Abebe Kebede Tessema"],
  };

  it("the combined file binds the certificate filed under the selected expert's name, and only that one", () => {
    const plan = planAnnexBundle(input);
    const part = plan.parts.find((p) => p.kind === CERTIFICATES);
    assert.ok(part, `not bound; missing: ${JSON.stringify(plan.missing)}`);
    assert.deepEqual(part.documents.map((d) => d.id), ["cert-abebe"], "another person's certificate is not bound");
    assert.ok(!plan.missing.some((m) => m.kind === CERTIFICATES), "no missing-annex blocker for it");
  });

  it("the owner checklist sees the same original", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [{ id: "r1", title: "Supporting documents", description: ATTACH, requirementType: "SUBMISSION_RULE", priority: "MANDATORY" }],
      declaredFileNames: ["Technical Proposal.pdf"],
      vaultDocuments: input.vaultDocuments,
      selectedExpertSourceDocumentIds: ["cv-abebe"],
      selectedProjectSourceDocumentIds: [],
      selectedExpertNames: ["Eng. Abebe Kebede Tessema"],
      formsAwaitingOriginal: [],
      boundHashes: [],
    });
    const item = list.items.find((i) => i.kind === CERTIFICATES);
    assert.ok(item, JSON.stringify(list.items.map((i) => i.kind)));
    assert.equal(item.vault.status, "VERIFIED_PDF_ORIGINAL");
    assert.deepEqual(item.vault.documents, ["Abebe_Kebede_PE_Licence.pdf"]);
  });

  it("a file is the expert's only when it names them: first name and another part, whole words", () => {
    const expert = "Eng. Abebe Kebede Tessema";
    assert.equal(fileNamedForExpert("Abebe_Kebede_PE_Licence.pdf", expert), true);
    assert.equal(fileNamedForExpert("abebe-tessema certificate.pdf", expert), true);
    assert.equal(fileNamedForExpert("Kebede licence.pdf", expert), false, "no first name");
    assert.equal(fileNamedForExpert("Abebe licence.pdf", expert), false, "first name alone");
    assert.equal(fileNamedForExpert("Abebech Kebede licence.pdf", expert), false, "a different name that starts the same");
    assert.equal(fileNamedForExpert("Abebe licence.pdf", "Abebe"), false, "a one-word name binds nothing");
    assert.equal(fileNamedForExpert("Jose_Munoz_cert.pdf", "Dr. José Muñoz"), true, "accents and titles");
  });
});

describe("4. the tender's validity is the offer's, never a bid security's", () => {
  const PAD = " The consultant shall carry out the services described in the terms of reference with due care and diligence.".repeat(6);
  const cases: Array<[string, number | null]> = [
    ["The bid security shall be valid for 120 days beyond the deadline. Bids shall remain valid for 90 days after the submission deadline.", 90],
    ["Validity of the bid security: 120 days. Proposal validity: 60 days.", 60],
    ["A bid security of ETB 50,000 is required. Validity: 90 days.", 90],
    ["The performance guarantee shall be valid for 28 days after completion.", null],
    ["Proposal validity: 90 days.", 90],
  ];

  it("the tender-detail field extractor", () => {
    for (const [text, days] of cases) {
      const field = extractValidityDays({ files: [{ fileName: "rfp.pdf", extractedText: text, totalPages: 1 }] } as never) as { found: boolean; value?: number };
      assert.equal(field.found ? field.value : null, days, text);
    }
  });

  it("the upload-time metadata extractor", () => {
    for (const [text, days] of cases) {
      assert.equal(inferTenderMetadata(`REQUEST FOR PROPOSALS.${PAD} ${text}${PAD}`, "rfp.pdf").validityDays, days, text);
    }
  });

  it("the pricing estimate", () => {
    const est = estimateTenderPrice({
      tender: { id: "t", title: "Design", country: "Kenya", category: null, currency: null, budget: null },
      tenderText: cases[0]![0], experts: [], historicalProjects: [], priorRates: [], companyDefaultCurrency: null, now: new Date("2026-10-12"),
    });
    assert.equal(est.validityDays, 90);
  });

  it("the shared rule reads only the sentence the figure is in", () => {
    const text = "The bid security is ETB 50,000. Validity: 90 days.";
    const i = text.indexOf("Validity");
    assert.equal(validityBelongsToSecurity(text, i, "Validity: 90 days".length), false, "a security in the previous sentence is not this figure's subject");
    const t2 = "The bid security shall be valid for 120 days.";
    assert.equal(validityBelongsToSecurity(t2, t2.indexOf("valid"), "valid for 120 days".length), true);
  });
});
