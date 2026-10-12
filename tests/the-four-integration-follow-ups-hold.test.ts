// The four follow-ups left after PR #1175 merged into integration (Codex
// review of 0b0a4181, plus the tender-detail validity extractor noted in the
// closure). The pure halves are here; the password-reset and
// extraction-quality halves run on PostgreSQL in
// tests/the-four-integration-follow-ups-db.test.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { planAnnexBundle, expertFiledUnder, type AnnexVaultDocument } from "../lib/engine/annex-bundle";
import { buildOwnerAttachmentChecklist } from "../lib/engine/owner-attachment-checklist";
import { extractValidityDays } from "../lib/engine/tender-field-extractors";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";
import { estimateTenderPrice } from "../lib/engine/pricing-intelligence";
import { isOfferValidity } from "../lib/engine/validity-subject";

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
      vault("cert-abebe", "CERTIFICATION", "Abebe_Kebede_Tessema_PE_Licence.pdf"),
      vault("cert-other", "CERTIFICATION", "Selam Haile licence.pdf"),
      vault("cert-sibling", "CERTIFICATION", "Abebe_Kebede_Girma_Licence.pdf"),
    ],
    selectedExpertSourceDocumentIds: ["cv-abebe"],
    selectedProjectSourceDocumentIds: [],
    selectedExpertNames: ["Eng. Abebe Kebede Tessema"],
    companyExpertNames: ["Eng. Abebe Kebede Tessema", "Selam Haile", "Abebe Kebede Girma"],
  };

  it("the combined file binds the certificate filed under the selected expert's name, and only that one", () => {
    const plan = planAnnexBundle(input);
    const part = plan.parts.find((p) => p.kind === CERTIFICATES);
    assert.ok(part, `not bound; missing: ${JSON.stringify(plan.missing)}`);
    assert.deepEqual(part.documents.map((d) => d.id), ["cert-abebe"], "another person's certificate — a sibling's included — is not bound");
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
      companyExpertNames: input.companyExpertNames,
      formsAwaitingOriginal: [],
      boundHashes: [],
    });
    const item = list.items.find((i) => i.kind === CERTIFICATES);
    assert.ok(item, JSON.stringify(list.items.map((i) => i.kind)));
    assert.equal(item.vault.status, "VERIFIED_PDF_ORIGINAL");
    assert.deepEqual(item.vault.documents, ["Abebe_Kebede_Tessema_PE_Licence.pdf"]);
  });

  it("a file is the expert's only when it names them fully and no other expert fits it as well", () => {
    const selected = ["Eng. Abebe Kebede Tessema"];
    const firm = ["Eng. Abebe Kebede Tessema", "Abebe Kebede Girma", "Mohammed Ahmed", "Mohammed Ahmed Hassan"];
    assert.ok(expertFiledUnder("Abebe_Kebede_Tessema_PE_Licence.pdf", selected, firm));
    assert.equal(expertFiledUnder("Abebe_Kebede_PE_Licence.pdf", selected, firm), null, "part of the name is not enough");
    assert.equal(expertFiledUnder("Abebe_Kebede_Girma_Licence.pdf", selected, firm), null, "a sibling who shares two names");
    assert.equal(expertFiledUnder("Mohammed_Ahmed_Hassan_Licence.pdf", ["Mohammed Ahmed"], firm), null, "the fuller name that fits is another expert's");
    assert.ok(expertFiledUnder("Mohammed_Ahmed_Licence.pdf", ["Mohammed Ahmed"], firm));
    assert.equal(expertFiledUnder("Abebe licence.pdf", ["Abebe"], ["Abebe"]), null, "a one-word name binds nothing");
    assert.ok(expertFiledUnder("Jose_Munoz_cert.pdf", ["Dr. José Muñoz"], []), "accents and titles");
    assert.equal(expertFiledUnder("Abebe_Kebede_Licence.pdf", ["Abebe Kebede"], ["Abebe Kebede", "Eng. Abebe Kebede"]), null, "two of the firm's experts share the name");
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["Dr. John Doe, Ph.D."], ["Dr. John Doe, Ph.D."]), "credentials after the name are not part of it");
    assert.ok(expertFiledUnder("Jane_Roe_Licence.pdf", ["Jane Roe, PE"], ["Jane Roe, PE"]), "PE after a comma is a credential");
    assert.equal(expertFiledUnder("Chen_Li_Licence.pdf", ["Chen Li Peng"], ["Chen Li Peng"]), null, "a trailing word without a comma is a name part");
    assert.equal(expertFiledUnder("Li_Wang_Licence.pdf", ["Peng Li Wang"], ["Peng Li Wang"]), null, "a name part that looks like a credential is still a name part");
    assert.ok(expertFiledUnder("Peng_Li_Wang_Licence.pdf", ["Peng Li Wang"], ["Peng Li Wang"]));
    assert.equal(expertFiledUnder("Wei_Ming_Licence.pdf", ["Eng Wei Ming"], ["Eng Wei Ming"]), null, "Eng without a full stop is a surname");
    assert.ok(expertFiledUnder("Ma_Jun_Licence.pdf", ["Ma Jun"], ["Ma Jun"]), "a surname that looks like a degree is kept");
  });

  it("a surname-first name keeps its given names; credentials and suffixes after a comma are not name parts", () => {
    const firm = ["Doe, John", "Kebede, Abebe", "Kebede, Girma"];
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["Doe, John"], firm), "surname-first");
    assert.equal(expertFiledUnder("Doe_Licence.pdf", ["Doe, John"], firm), null, "the surname alone is not the expert");
    assert.ok(expertFiledUnder("Abebe_Kebede_Licence.pdf", ["Kebede, Abebe"], firm));
    assert.equal(expertFiledUnder("Girma_Kebede_Licence.pdf", ["Kebede, Abebe"], firm), null, "a sibling's file");
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["Doe, John, PE"], ["Doe, John, PE"]), "given names, then a credential");
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["Doe, John Jr."], ["Doe, John Jr."]), "a suffix is not a name part");
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["Doe, Dr. John"], ["Doe, Dr. John"]), "a title before the given names");
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["John Doe, MSc"], ["John Doe, MSc"]), "MSc is a credential");
    assert.equal(expertFiledUnder("Doe_Licence.pdf", ["Doe, JOHN"], ["Doe, JOHN"]), null, "a segment not written as a name is never read as one, and the rest is too short");
    assert.ok(expertFiledUnder("John_A_Doe_Licence.pdf", ["Doe, John A."], ["Doe, John A."]), "an initial is skipped, not a reason to drop the given name");
    assert.ok(expertFiledUnder("John_Doe_Licence.pdf", ["Doe, John A."], ["Doe, John A."]));
    assert.equal(expertFiledUnder("Ali_Licence.pdf", ["Ali Ali"], ["Ali Ali"]), null, "a repeated name part is needed as often as the name has it");
    assert.ok(expertFiledUnder("Ali_Ali_Licence.pdf", ["Ali Ali"], ["Ali Ali"]));
  });

  it("without the firm's expert list nothing is bound by name", () => {
    const plan = planAnnexBundle({ ...input, companyExpertNames: undefined });
    assert.ok(plan.missing.some((m) => m.kind === CERTIFICATES));
  });
});

describe("4. the tender's validity is the offer's, never a bid security's", () => {
  const PAD = " The consultant shall carry out the services described in the terms of reference with due care and diligence.".repeat(6);
  const cases: Array<[string, number | null]> = [
    ["The bid security shall be valid for 120 days beyond the deadline. Bids shall remain valid for 90 days after the submission deadline.", 90],
    ["Validity of the bid security: 120 days. Proposal validity: 60 days.", 60],
    ["A bid security of ETB 50,000 is required. Validity: 90 days.", null],
    ["The performance guarantee shall be valid for 28 days after completion.", null],
    ["Proposal validity: 90 days.", 90],
    ["Bid security required; validity: 120 days.", null],
    ["The bid security shall be issued by a reputable bank acceptable to the employer and shall remain valid for 120 days. Proposals shall remain valid for 90 days.", 90],
    ["The bid security shall be issued by ABC Bank Ltd. and shall remain valid for 120 days. Proposals shall remain valid for 90 days.", 90],
    ["EMD validity: 120 days. Proposal validity: 90 days.", 90],
    ["The bid security shall be issued by U.S. Bank and shall remain valid for 120 days. Proposals shall remain valid for 90 days.", 90],
    ["The bid shall include a bid security and shall remain valid for 120 days.", null],
    ["The bid shall include a bid security and remain valid for 120 days.", null],
    ["Bids must be accompanied by a bid security valid for 120 days and remain valid for 60 days.", null],
    ["The bid shall be signed and remain valid for 90 days.", 90],
    ["The bid shall include a bid security, which shall be issued by a bank and remain valid for 120 days. Proposals shall remain valid for 90 days.", 90],
    ["A bid security is required. The bid shall include this instrument. It shall remain valid for 120 days. Proposals shall remain valid for 90 days.", 90],
    ["The tender security is required. It shall remain valid for 120 days. Proposals shall remain valid for 60 days.", 60],
    ["The bid security is required. Its validity: 120 days. Proposal validity: 90 days.", 90],
    ["If a bid security is required, the bid shall include it and remain valid for 120 days.", null],
    ["Proposals must be submitted in English. It shall remain valid for 90 days.", null],
    ["The earnest money deposit shall be valid for 120 days. Bids shall remain valid for 90 days.", 90],
    ["The bid security shall be\nvalid for 120 days after the deadline.", null],
    ["The bid security shall be issued by 31 Jan. 2027 and remain valid for 120 days. Proposals shall remain valid for 90 days.", 90],
    ["The bid security, issued on 3 Sept. 2026, shall remain valid for 120 days.", null],
    ["The bid security shall be valid for 120 days. 2.1 Bid validity: 90 days.", 90],
    ["The bid security shall be valid for 120 days. 18. Bids shall remain valid for 60 days.", 60],
    ["The bidder must hold a business licence valid for 365 days. Proposals shall remain valid for 90 days.", 90],
    ["Validity: 120 days for the bid security. Proposal validity: 90 days.", 90],
    ["Validity: 90 days.", null],
    ["Proposals must be submitted in English. They shall remain valid for 90 days.", null],
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
    const semicolon = estimateTenderPrice({
      tender: { id: "t", title: "Design", country: "Kenya", category: null, currency: null, budget: null },
      tenderText: "Bid security required; validity: 120 days.", experts: [], historicalProjects: [], priorRates: [], companyDefaultCurrency: null, now: new Date("2026-10-12"),
    });
    assert.equal(semicolon.validityDays, 90, "the security's 120 days after a semicolon is not the offer's");
    assert.match(semicolon.validityBasis, /validity periods, but none as the offer's \(a bid security's, for one, is not\); 90 days assumed — confirm/, "the assumption is said, not hidden");
    assert.ok(semicolon.lowConfidence.some((note) => /^Validity:/.test(note)), "and listed for confirmation before approval");
  });

  it("the shared rule reads only the sentence the figure is in", () => {
    const text = "The bid security is ETB 50,000. Validity: 90 days.";
    const i = text.indexOf("Validity");
    assert.equal(isOfferValidity(text, i, "Validity: 90 days".length), false, "a bare validity names no offer, so it is not read as the offer's");
    const t3 = "The bid security is ETB 50,000. Bid validity: 90 days.";
    assert.equal(isOfferValidity(t3, t3.indexOf("validity"), "validity: 90 days".length), true, "the offer named on the validity; a security in the previous sentence is not its subject");
    const t4 = "The validity of the bids: 75 days.";
    assert.equal(isOfferValidity(t4, t4.indexOf("validity"), "validity of the bids: 75 days".length), true, "the offer named after the validity");
    const t5 = "The bidder must hold a business licence valid for 365 days.";
    assert.equal(isOfferValidity(t5, t5.indexOf("valid "), "valid for 365 days".length), false, "a licence's validity");
    const t2 = "The bid security shall be valid for 120 days.";
    assert.equal(isOfferValidity(t2, t2.indexOf("valid"), "valid for 120 days".length), false);
  });
});
