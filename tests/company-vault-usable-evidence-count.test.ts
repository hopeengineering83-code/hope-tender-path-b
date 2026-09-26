// The Company Vault page used to fetch /api/company/ingestion-readiness on
// every load, store the result in `reviewTotals`, maintain that state across
// four different delete paths — and never render it. The count it was so
// careful to keep canonical was write-only. Meanwhile the page told the user
// "N records · automatically verified before use", which is a claim about the
// pipeline, not a report of what actually happened: if 3 of 10 experts failed
// source verification, the Engine silently excluded them and the page said
// nothing.
//
// The fetch now feeds a rendered count, and deletes re-ask the server instead
// of guessing locally. These tests hold both halves in place: the number the
// page shows is the number the Engine's gate uses, and the page keeps no
// state it never reads.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { assessCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { canUseVaultRecordSafely } from "../lib/vault-runtime-authority";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
  type ReviewRecordState,
} from "../lib/vault-review-provenance";

const PAGE = readFileSync("app/dashboard/company/page.tsx", "utf8");

/** A record that genuinely passes durable source verification. */
function verifiedExpert(): ReviewRecordState {
  const fullName = "Verified Expert";
  const text = [
    "CURRICULUM VITAE",
    `Name of Key Expert: ${fullName}`,
    `${fullName} is a Senior Consultant with 12 years of experience in General Consultancy Services.`,
  ].join("\n");
  const sourceDocument = {
    id: "doc-verified",
    companyId: "co-1",
    extractedText: text,
    contentSha256: createHash("sha256").update(text).digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
    metadata: JSON.stringify({ extractionRevision: 1 }),
  };
  const fields = {
    fullName,
    title: "Senior Consultant",
    yearsExperience: 12,
    disciplines: JSON.stringify(["General Consultancy Services"]),
    sectors: JSON.stringify([]),
    certifications: JSON.stringify([]),
  };
  const provenance = buildSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(fields),
    verificationMethod: "HYBRID",
  });
  if (!provenance.ok) throw new Error("fixture provenance failed to build");

  return {
    ...fields,
    id: "expert-verified",
    companyId: "co-1",
    trustLevel: "SOURCE_VERIFIED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: provenance.serialized,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
  } as unknown as ReviewRecordState;
}

describe("Company Vault usable-evidence count", () => {
  it("counts exactly the records the Engine's gate would accept, not every stored row", () => {
    const usable = verifiedExpert();
    const draft = { trustLevel: "AI_DRAFT" } as ReviewRecordState;
    // A SOURCE_VERIFIED row wearing reviewer metadata is not durable — the
    // count must not be fooled by the trustLevel string alone.
    const laundered = {
      trustLevel: "SOURCE_VERIFIED",
      sourceDocumentId: "doc-1",
      reviewedBy: "system",
      reviewedAt: new Date(),
      reviewNotes: null,
    } as ReviewRecordState;

    const records = [usable, draft, laundered];
    const result = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "Company evidence ".repeat(20) }],
      experts: records.map((record) => ({
        trustLevel: (record as { trustLevel: string }).trustLevel,
        durableGenerationEligibility: canUseVaultRecordSafely(record, "GENERATION"),
      })),
      projects: [],
    });

    assert.equal(records.length, 3);
    assert.equal(result.totals.reviewedExperts, 1, "only the durably verified record is usable evidence");
    assert.equal(
      result.totals.reviewedExperts,
      records.filter((record) => canUseVaultRecordSafely(record, "GENERATION")).length,
      "the displayed count and the Engine's gate must be the same number",
    );
  });

  it("reports zero usable evidence when every record is a draft, even with rows present", () => {
    const result = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "Company evidence ".repeat(20) }],
      experts: [
        { trustLevel: "AI_DRAFT", durableGenerationEligibility: false },
        { trustLevel: "REGEX_DRAFT", durableGenerationEligibility: false },
      ],
      projects: [{ trustLevel: "MANUAL_DRAFT", durableGenerationEligibility: false }],
    });

    assert.equal(result.totals.experts, 2);
    assert.equal(result.totals.reviewedExperts, 0);
    assert.equal(result.totals.projects, 1);
    assert.equal(result.totals.reviewedProjects, 0);
  });

  it("renders the fetched count instead of storing it write-only", () => {
    assert.match(PAGE, /fetch\("\/api\/company\/ingestion-readiness"\)/);
    assert.match(PAGE, /reviewedExperts/, "the page must read the canonical eligible-expert total");
    assert.match(PAGE, /reviewedProjects/, "the page must read the canonical eligible-project total");
    assert.match(PAGE, /\{usableEvidence\.experts\}/, "the expert count must reach the DOM");
    assert.match(PAGE, /\{usableEvidence\.projects\}/, "the project count must reach the DOM");
    assert.doesNotMatch(PAGE, /humanReviewedExperts|humanReviewedProjects/,
      "the human-review totals are not what this page gates on and must not reappear");
  });

  it("re-reads the server after a delete rather than decrementing a count it cannot compute", () => {
    // Four delete paths can change the count: one expert, one project, all
    // experts, all projects. Each must re-ask the canonical resolver. A bare
    // "the function is mentioned somewhere" check is not enough — dropping one
    // call site would leave the other three and pass.
    const callSites = PAGE.match(/void refreshUsableEvidence\(\)/g) ?? [];
    assert.equal(callSites.length, 4, "every delete path must re-read the canonical count");

    // Whether a deleted row was source-verified is exactly what the browser
    // cannot know, so any local "minus one" drifts away from the Engine —
    // regardless of which variable the arithmetic is written against.
    assert.doesNotMatch(PAGE, /(?:experts|projects|Experts|Projects)\s*[-+]\s*1\b/,
      "usable-evidence counts must never be adjusted arithmetically on the client");
    assert.doesNotMatch(PAGE, /Math\.max\(0,\s*rt\./);
  });

  it("keeps the count informational — no review, approval, or navigation is offered", () => {
    const start = PAGE.indexOf("Knowledge vault");
    assert.ok(start > 0, "the knowledge vault summary block must exist");
    const block = PAGE.slice(start, PAGE.indexOf("})()}", start));

    // No control of any kind: nothing to click, nowhere to navigate, and no
    // wording that implies a pending human step.
    assert.doesNotMatch(block, /href=|router\.push|<button|onClick=/i);
    assert.match(block, /no action is needed here/i);
  });
});
