// The tender decides what documents exist.
//
// The App generates every bidder-created document the tender requires and
// nothing else; a financial proposal exists only when the tender asks the
// bidder for prices; the original and supporting documents are compiled by
// the owner, and their absence from the Company Vault never stops the App
// from finishing its own work. (Owner rule, 2026-10-11.)
//
// Before this: the Pricing Intelligence panel asked for rates on a
// technical-only tender (Pharo, Preview 2026-10-10); the derived plan preview
// offered a "Financial Proposal" from the word "budget" and a "Financial
// Capacity Package" from audited statements; "Financial proposals will be
// requested later" read as a financial obligation; and the readiness panel
// showed a finished proposal as "Export gate blocked — resolve blockers first".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildSubmissionPlan, buildDerivedDraftPlan, findExtraGeneratedDocuments, inferEnvelope, priceSubmissionGrounding } from "../lib/engine/submission-plan";
import { readFinancialProposalRequirement, statesFinancialProhibition } from "../lib/engine/source-driven-tender-text-parser";
import { isPriceSubmissionFile, resolvePricingScope } from "../lib/engine/pricing-submission-scope";
import { buildOwnerAttachmentChecklist, ownerAttachmentChecklistText } from "../lib/engine/owner-attachment-checklist";
import { finalPackageStatus, isProposalCompleteExceptOwnerAttachments, PROPOSAL_COMPLETE_LABEL } from "../lib/engine/final-submission-readiness";
import { classifyTender } from "../lib/engine/tender-classification";
import { technicalOnlyNote } from "../lib/engine/generate-elite";
import { approvePricingEstimate } from "../lib/engine/pricing-approval";
import { validateBuildPlanItemsAtRuntime } from "../lib/engine/build-plan";
import { presentTwoActionWorkflowDecision } from "../lib/engine/two-action-workflow-presentation";

type Row = { id: string; title: string; description: string; requirementType: string; priority: string; exactFileName?: string | null; restrictions?: string | null; sourcePageNumber?: number; sourceExactQuote?: string };
const row = (id: string, title: string, description: string, requirementType = "SUBMISSION_RULE", extra: Partial<Row> = {}): Row =>
  ({ id, title, description, requirementType, priority: "MANDATORY", ...extra });
const planOf = (requirements: Row[], extra: Record<string, unknown> = {}) => buildSubmissionPlan({ id: "t", requirements, ...extra } as never);
const priceFiles = (plan: ReturnType<typeof planOf>) => plan.files.filter((f) => isPriceSubmissionFile(f.exactFileName, f.documentType));
const textOf = (rows: Row[]) => rows.map((r) => `${r.title}. ${r.description}`).join("\n");
const read = (path: string) => readFileSync(path, "utf8");

describe("CASE 1 — a technical-only tender", () => {
  const rows = [
    row("r1", "Technical Proposal", "Bidders shall submit a Technical Proposal only.", "TECHNICAL", { exactFileName: "Technical Proposal.pdf" }),
    row("r2", "Evaluation", "Proposals are scored: technical 70%, financial 30%.", "EVALUATION_CRITERIA", { priority: "SCORED" }),
  ];
  const plan = planOf(rows);

  it("plans the Technical Proposal and no financial proposal", () => {
    assert.ok(plan.files.some((f) => f.exactFileName === "Technical Proposal.pdf"), plan.files.map((f) => f.exactFileName).join(", "));
    assert.deepEqual(priceFiles(plan), []);
  });
  it("activates no pricing: no estimate, no request for the owner's rates", () => {
    const scope = resolvePricingScope({ confirmedPlanItems: plan.files, tenderText: "" });
    assert.equal(scope.required, false);
    assert.match(scope.basis, /Not required by this tender/);
  });
  it("a scoring weight alone is not a request for a price", () => {
    assert.equal(readFinancialProposalRequirement("Evaluation: technical 70%, financial proposal 30%."), null);
  });
});

describe("CASE 2 — an EOI that forbids prices", () => {
  const rows = [
    row("r1", "Expression of Interest", "Interested firms shall submit an expression of interest describing their qualifications and similar assignments.", "TECHNICAL"),
    row("r2", "Pricing", "Bidders shall not submit prices with this EOI. Financial proposals will be requested only from shortlisted firms.", "SUBMISSION_RULE"),
    row("r3", "Price Schedule", "Complete the price schedule form.", "FORM", { exactFileName: "Price Schedule.xlsx" }),
  ];

  it("the prohibition is read, in its owner's words and its variants", () => {
    for (const body of [
      "Do not submit prices.",
      "No financial proposal at this stage.",
      "Financial proposal will be requested later.",
      "This is an EOI only.",
      "Technical proposal only.",
      "Price information shall not be included.",
      "No prices should be provided with this EOI.",
    ]) assert.equal(readFinancialProposalRequirement(`EXPRESSION OF INTEREST\n${body}`), false, body);
  });
  it("overrides every generic financial signal: no price file even when a row names one", () => {
    const plan = planOf(rows);
    assert.deepEqual(priceFiles(plan).map((f) => f.exactFileName), []);
    assert.ok(plan.warnings.some((w) => /Price Schedule\.xlsx/.test(w) && /rules out a price submission/.test(w)), plan.warnings.join(" | "));
  });
  it("the plan preview offers no financial proposal either", () => {
    assert.ok(!buildDerivedDraftPlan({ requirements: rows }).some((e) => /financial/i.test(e.name)));
  });
  it("keeping prices out of the technical part of a two-envelope tender is not a prohibition", () => {
    const text = "Submit technical and financial proposals in separate envelopes. No price information shall be included in the technical proposal.";
    assert.equal(statesFinancialProhibition(text), false);
    assert.equal(readFinancialProposalRequirement(text), true);
  });
});

describe("CASE 3 — audited financial statements, no price requested", () => {
  const rows = [
    row("r1", "Audited Financial Statements", "Bidders shall submit audited financial statements for the last three years.", "FINANCIAL"),
    row("r2", "Technical Proposal", "Submit a technical proposal.", "TECHNICAL", { exactFileName: "Technical Proposal.pdf" }),
  ];

  it("financial qualification evidence is not a financial proposal", () => {
    assert.equal(readFinancialProposalRequirement(textOf(rows)), null);
    assert.deepEqual(priceFiles(planOf(rows)), []);
    assert.equal(isPriceSubmissionFile("Audited Financial Statements.pdf", "FINANCIAL"), false);
    assert.equal(isPriceSubmissionFile("Financial Capacity Form.docx", "FORM"), false);
  });
  it("it goes with the eligibility documents, not into the sealed financial envelope", () => {
    assert.equal(inferEnvelope("FINANCIAL", "Audited Financial Statements.pdf"), "ADMIN");
    assert.equal(inferEnvelope("FORM", "Financial Capacity Form.docx"), "ADMIN");
    assert.equal(inferEnvelope("FINANCIAL", "Financial-Proposal.xlsx"), "FINANCIAL");
  });
  it("it is an original the owner compiles", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: rows, declaredFileNames: ["Technical Proposal.pdf"], vaultDocuments: [],
      selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [],
    });
    const audited = list.items.find((i) => i.kind === "Audited financial statements");
    assert.ok(audited, list.items.map((i) => i.kind).join(", "));
    assert.equal(audited!.status, "OWNER_TO_ATTACH");
  });
  it("a mandatory row titled as an original is listed however its description reads", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [row("r1", "Valid Business License", "Proof of a valid business license; this eligibility criterion will be evaluated on a pass/fail basis.", "ELIGIBILITY")],
      declaredFileNames: [], vaultDocuments: [], selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [],
    });
    assert.deepEqual(list.items.map((i) => i.kind), ["Business licence and registration certificates"]);
    assert.equal(list.mode, "SEPARATE_ATTACHMENTS");
  });
  it("the plan preview offers no 'Financial Capacity Package'", () => {
    assert.ok(!buildDerivedDraftPlan({ requirements: rows }).some((e) => /financial/i.test(e.name)));
  });
});

describe("CASE 4 — a client budget, no financial submission", () => {
  const rows = [
    row("r1", "Budget", "The Client's budget for this assignment is ETB 4,500,000 inclusive of VAT. Payment will be made in three instalments.", "GENERAL"),
    row("r2", "Methodology", "Describe the approach and methodology.", "METHODOLOGY"),
  ];
  it("plans no financial proposal and asks for no price", () => {
    assert.equal(readFinancialProposalRequirement(textOf(rows)), null);
    assert.deepEqual(priceFiles(planOf(rows)), []);
    assert.ok(!buildDerivedDraftPlan({ requirements: rows }).some((e) => /financial/i.test(e.name)));
    assert.equal(resolvePricingScope({ confirmedPlanItems: null, tenderText: textOf(rows) }).required, false);
  });
});

describe("CASE 5 — the tender requires a financial proposal", () => {
  const rows = [
    row("r1", "Technical Proposal", "Submit a technical proposal.", "TECHNICAL", { exactFileName: "Technical Proposal.pdf" }),
    row("r2", "Financial Proposal", "The Financial Proposal shall be submitted, priced in Ethiopian Birr inclusive of VAT.", "FINANCIAL"),
  ];
  const plan = planOf(rows);
  it("plans it in the financial envelope, from its requirement", () => {
    const files = priceFiles(plan);
    assert.equal(files.length, 1, plan.files.map((f) => f.exactFileName).join(", "));
    assert.equal(files[0]!.envelope, "FINANCIAL");
    assert.deepEqual(files[0]!.sourceRequirementIds, ["r2"]);
  });
  it("activates pricing, naming the planned file", () => {
    const scope = resolvePricingScope({ confirmedPlanItems: plan.files, tenderText: "" });
    assert.equal(scope.required, true);
    assert.match(scope.basis, /Financial Proposal/);
  });
});

describe("CASE 6 — a separate financial envelope", () => {
  const rows = [
    row("r1", "Technical Proposal", "Submit a technical proposal.", "TECHNICAL", { exactFileName: "Technical Proposal.pdf" }),
    row("r2", "Financial Proposal", "The Financial Proposal shall be submitted in a separate sealed envelope, priced in Birr.", "FINANCIAL"),
  ];
  it("technical and financial are separate files in separate envelopes", () => {
    const plan = planOf(rows);
    const technical = plan.files.find((f) => f.exactFileName === "Technical Proposal.pdf");
    const financial = priceFiles(plan)[0];
    assert.equal(technical?.envelope, "TECHNICAL");
    assert.equal(financial?.envelope, "FINANCIAL");
    assert.notEqual(technical?.exactFileName, financial?.exactFileName);
  });
});

const COPIES = row("r1", "Submission documents", "Submit scanned copies of the trade licence, VAT registration certificate and tax clearance certificate.", "SUBMISSION_RULE", { sourcePageNumber: 4, sourceExactQuote: "Submit scanned copies of the trade licence, VAT registration certificate and tax clearance certificate." });
const verifiedPdf = (id: string, name: string, category: string) => ({ id, originalFileName: name, category, mimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED", contentSha256: `sha-${id}` });

describe("CASE 7 — originals the Vault does not hold", () => {
  const list = buildOwnerAttachmentChecklist({
    requirements: [COPIES], declaredFileNames: [], vaultDocuments: [],
    selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [],
  });

  it("lists each as a manual attachment, with its source, copy type and destination", () => {
    assert.ok(list.items.length >= 2);
    for (const item of list.items) {
      assert.equal(item.status, "OWNER_TO_ATTACH");
      assert.equal(item.vault.status, "NOT_IN_VAULT");
      assert.equal(item.source.page, 4);
      assert.equal(item.copyType, "SCANNED_COPY");
      assert.match(item.location, /Technical envelope, as Annex \d/);
      assert.match(item.ownerAction, /when assembling the final submission/);
      assert.doesNotMatch(item.ownerAction, /upload/i, "an upload is never the instruction");
    }
  });
  it("the App-generated proposal is complete: a success state, not a failure", () => {
    const complete = isProposalCompleteExceptOwnerAttachments({
      documentBlockers: [], tenderLevelBlockers: [{ category: "OWNER_ATTACHMENTS_REQUIRED" }],
      exportReadyCount: 1, formsAwaitingOriginal: [], plannedFileNames: [], missingPlanFileNames: [],
    });
    assert.equal(complete, true);
    assert.equal(finalPackageStatus({ ok: false, proposalComplete: complete }), "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    assert.equal(PROPOSAL_COMPLETE_LABEL, "PROPOSAL COMPLETE — MANUAL ORIGINAL ATTACHMENTS REQUIRED");
  });
  it("the App never claims the externally assembled submission is complete", () => {
    assert.notEqual(finalPackageStatus({ ok: false, proposalComplete: true }), "SUBMISSION_READY");
  });
  it("the proposal-only download depends on the proposal, never on a Vault upload", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes('const proposalOnly = !canonical.ok && packageScope === "proposal" && canonical.proposalComplete;'));
    const panel = read("components/export-readiness-panel.tsx");
    assert.match(panel, /download\?type=zip&scope=proposal/);
    assert.match(panel, /App-generated documents complete/);
  });
  it("the printable checklist says uploading is optional", () => {
    assert.match(ownerAttachmentChecklistText("Tender", list), /uploading them to the App is optional/);
  });
});

describe("CASE 8 — one combined submission file, originals absent", () => {
  const rule = row("r1", "Submission format", "Submit a single electronic PDF file named 'Technical Proposal.pdf' containing all required sections and annexes. Attach supporting documents such as company profile, professional CVs, licenses and certificates.");
  const list = buildOwnerAttachmentChecklist({
    requirements: [rule], declaredFileNames: ["Technical Proposal.pdf"], vaultDocuments: [],
    selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [], boundHashes: [],
  });

  it("the App's part is one file; the annex order is exact; the Vault is optional", () => {
    assert.equal(list.mode, "COMBINED_FILE");
    list.items.forEach((item, index) => {
      assert.equal(item.order, index + 1);
      assert.match(item.location, new RegExp(`Inside "Technical Proposal\\.pdf", after the proposal pages, as Annex ${index + 1}`));
      assert.match(item.ownerAction, /when assembling the file/);
      assert.match(item.ownerAction, /Optional: if you choose to store a verified PDF/);
    });
  });
  it("a missing annex original leaves the proposal complete", () => {
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      documentBlockers: [], tenderLevelBlockers: [{ category: "COMBINED_FILE_ANNEX_MISSING" }],
      exportReadyCount: 1, formsAwaitingOriginal: [], plannedFileNames: [], missingPlanFileNames: [],
    }), true);
  });
});

describe("CASE 9 — originals the Vault happens to hold", () => {
  const rule = row("r1", "Format", "One PDF file named 'Proposal.pdf' containing all annexes. Attach the company profile.");
  const base = { requirements: [rule], declaredFileNames: ["Proposal.pdf"], vaultDocuments: [verifiedPdf("p1", "Company Profile.pdf", "COMPANY_PROFILE")], selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], formsAwaitingOriginal: [] };
  it("are packaged automatically once bound, and say so", () => {
    const item = buildOwnerAttachmentChecklist({ ...base, boundHashes: ["sha-p1"] }).items[0]!;
    assert.equal(item.status, "PACKAGED_AUTOMATICALLY");
    assert.equal(item.vault.status, "VERIFIED_PDF_ORIGINAL");
  });
  it("are not claimed as packaged before they are", () => {
    assert.equal(buildOwnerAttachmentChecklist({ ...base, boundHashes: [] }).items[0]!.status, "OWNER_TO_ATTACH");
  });
});

describe("CASE 10 — no file without a tender requirement", () => {
  const rows = [row("r1", "Technical Proposal", "Submit a technical proposal only.", "TECHNICAL", { exactFileName: "Technical Proposal.pdf", sourcePageNumber: 1, sourceExactQuote: "Submit a technical proposal only." })];
  const plan = planOf(rows);

  it("a generated file outside the plan is found", () => {
    const extra = findExtraGeneratedDocuments(plan, [
      { id: "a", exactFileName: "Technical Proposal.pdf", generationStatus: "GENERATED" },
      { id: "b", exactFileName: "Financial Proposal.docx", generationStatus: "GENERATED" },
    ] as never);
    assert.deepEqual(extra.map((d) => (d as { exactFileName: string }).exactFileName), ["Financial Proposal.docx"]);
  });

  it("the Build Plan validator rejects an extra file, and a price file the tender rules out", async () => {
    const db = { tender: { findFirst: async () => ({ id: "t", files: [], requirements: rows }) } };
    const items = [
      { canonicalId: "req-r1", exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL", required: true, exactOrder: 1, sourceRequirementIds: ["r1"] },
      { canonicalId: "invented", exactFileName: "Financial Proposal.docx", documentType: "FINANCIAL_PROPOSAL", required: true, exactOrder: 2, sourceRequirementIds: [] },
      { canonicalId: "invented-2", exactFileName: "Design Statement.docx", documentType: "METHODOLOGY", required: true, exactOrder: 3, sourceRequirementIds: [] },
    ];
    const result = await validateBuildPlanItemsAtRuntime(db as never, "t", "u", items as never);
    assert.equal(result.ok, false);
    const text = result.blockers.join(" | ");
    assert.match(text, /Financial Proposal\.docx is a price submission the tender rules out/);
    assert.match(text, /Design Statement\.docx is not in current tender-controlled scope/);
    assert.match(text, /Design Statement\.docx has no linked requirements/);
  });

  it("the plan preview invents nothing because tenders commonly have it", () => {
    const rows = [
      row("r1", "Hospital design", "Design of a 100-bed hospital funded by the World Bank. Key personnel CVs. Work plan and schedule. Compliance checklist. Audited statements and bank statement.", "TECHNICAL"),
    ];
    const names = buildDerivedDraftPlan({ requirements: rows, title: "Hospital design — road access" }).map((e) => e.name);
    assert.deepEqual(names, ["Technical Proposal"]);
  });

  it("the price-submission grounding is the same for the planner and the validator", () => {
    assert.deepEqual(priceSubmissionGrounding({ requirements: rows } as never), { grounded: false, state: false });
  });
});

describe("pricing intelligence stays out of a tender that asks for no price", () => {
  it("approval is refused before any price is written", async () => {
    let wrote = false;
    const db = {
      tender: { findFirst: async () => ({ id: "t", exactFileNaming: null, files: [{ extractedText: "Technical proposal only." }], requirements: [] }) },
      buildPlan: { findFirst: async () => null },
      $transaction: async () => { wrote = true; },
    };
    const result = await approvePricingEstimate({ tenderId: "t", userId: "u", actorLabel: "owner", request: { scenario: "BALANCED" } as never }, db);
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "PRICING_NOT_REQUIRED_BY_TENDER");
    assert.equal(wrote, false);
  });
  it("the estimate route and both pricing panels obey the scope", () => {
    assert.match(read("app/api/tenders/[id]/pricing/estimate/route.ts"), /if \(!scope\.required\) return NextResponse\.json\(\{ estimate: null, scope \}\)/);
    assert.match(read("components/pricing-intelligence-panel.tsx"), /not required by this tender — not generated/);
    assert.match(read("components/pricing-workbook-panel.tsx"), /if \(!pricingRequired\) return null;/);
  });
});

describe("what the App says about a tender without a financial proposal", () => {
  it("the cover letter cites a tender instruction only when the tender gave one", () => {
    assert.match(technicalOnlyNote(true), /as required by the tender instructions/);
    assert.doesNotMatch(technicalOnlyNote(false), /as required by the tender instructions/);
    assert.match(technicalOnlyNote(false), /the tender does not ask the bidder for prices/);
  });
  it("a cover-page table row is not a technical+financial structure", () => {
    const pharoLike = "Technical Proposal / RFP\nIssuing Entity / Client: Example Ventures\nTender Status: Open\nFinancial Proposal: Not required at this stage.";
    assert.equal(classifyTender(pharoLike).procurementStructure, "technical-only");
    assert.equal(classifyTender("Request for Proposals. Consultants shall submit a technical proposal and a financial proposal.").procurementStructure, "technical-financial");
  });
  it("the next action for a complete proposal is to attach originals manually, not to upload them", () => {
    const decision = presentTwoActionWorkflowDecision({
      currentBlockingStage: "REQUIRED_DOCS_NOT_GENERATED", nextRequiredAction: "GENERATE_DOCUMENTS", nextRequiredActionLabel: "x", nextRequiredActionReason: "x",
      requiredDocumentsTotal: 2, generatedDocumentsTotal: 1, awaitingOwnerOriginalFileNames: ["Declaration.docx"],
    } as never)!;
    assert.equal(decision.nextRequiredActionLabel, "Proposal complete — attach originals manually");
    assert.match(decision.nextRequiredActionReason, /Attach each manually when assembling the final submission/);
    assert.match(decision.nextRequiredActionReason, /Optional: upload/);
  });
});
