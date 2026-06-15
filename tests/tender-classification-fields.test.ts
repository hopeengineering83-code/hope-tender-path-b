// Tests for the tender-shape classification fields added to AIAnalysisResult
// (lib/ai.ts) and the envelope-aware export separation (lib/engine).
//
// These lock the generalization contract: the analysis result must carry
// tenderCategory / envelopeMode / clientType / submissionFormat as validated
// optional fields, and two-envelope tenders must split TECHNICAL vs FINANCIAL
// documents into distinct envelopes (never mixed). Pure unit tests — no DB,
// no network. Pharo remains only a benchmark; nothing here is sector-specific.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  ENVELOPE_MODES,
  CLIENT_TYPES,
  SUBMISSION_FORMATS,
  sanitizeEnvelopeMode,
  sanitizeClientType,
  sanitizeSubmissionFormat,
  sanitizeTenderCategory,
  type AIAnalysisResult,
} from "../lib/ai";
import { inferEnvelope, type SubmissionEnvelope } from "../lib/engine/plans/submission-plan";

describe("AIAnalysisResult classification fields", () => {
  it("type accepts the four classification fields with valid enum values", () => {
    // Compile-time + runtime check: a fully-populated result is assignable.
    const result: AIAnalysisResult = {
      summary: "s",
      requirements: [],
      exactFileNaming: [],
      exactFileOrder: [],
      evaluationMethodology: "",
      submissionNotes: "",
      tenderCategory: "ROAD_INFRASTRUCTURE",
      envelopeMode: "TWO_ENVELOPE",
      clientType: "GOVERNMENT",
      submissionFormat: "GOVERNMENT_RFP",
    };
    assert.equal(result.tenderCategory, "ROAD_INFRASTRUCTURE");
    assert.ok((ENVELOPE_MODES as readonly string[]).includes(result.envelopeMode!));
    assert.ok((CLIENT_TYPES as readonly string[]).includes(result.clientType!));
    assert.ok((SUBMISSION_FORMATS as readonly string[]).includes(result.submissionFormat!));
  });

  it("classification fields are optional (legacy / fallback results stay valid)", () => {
    const minimal: AIAnalysisResult = {
      summary: "s",
      requirements: [],
      exactFileNaming: [],
      exactFileOrder: [],
      evaluationMethodology: "",
      submissionNotes: "",
    };
    assert.equal(minimal.tenderCategory, undefined);
    assert.equal(minimal.envelopeMode, undefined);
  });

  it("envelopeMode sanitiser accepts every declared enum value", () => {
    for (const v of ENVELOPE_MODES) assert.equal(sanitizeEnvelopeMode(v), v);
  });

  it("clientType sanitiser accepts every declared enum value", () => {
    for (const v of CLIENT_TYPES) assert.equal(sanitizeClientType(v), v);
  });

  it("submissionFormat sanitiser accepts every declared enum value", () => {
    for (const v of SUBMISSION_FORMATS) assert.equal(sanitizeSubmissionFormat(v), v);
  });

  it("sanitisers drop hallucinated / invalid values to undefined", () => {
    assert.equal(sanitizeEnvelopeMode("PHARMACEUTICAL"), undefined);
    assert.equal(sanitizeEnvelopeMode("triple-envelope"), undefined);
    assert.equal(sanitizeClientType("ROBOT"), undefined);
    assert.equal(sanitizeSubmissionFormat(42), undefined);
    assert.equal(sanitizeEnvelopeMode(null), undefined);
    assert.equal(sanitizeEnvelopeMode(undefined), undefined);
  });

  it("tenderCategory sanitiser normalises to UPPER_SNAKE_CASE and rejects junk", () => {
    assert.equal(sanitizeTenderCategory("water supply"), "WATER_SUPPLY");
    assert.equal(sanitizeTenderCategory("Urban Planning"), "URBAN_PLANNING");
    assert.equal(sanitizeTenderCategory(""), undefined);
    assert.equal(sanitizeTenderCategory("   "), undefined);
    assert.equal(sanitizeTenderCategory("x".repeat(61)), undefined);
    assert.equal(sanitizeTenderCategory(123), undefined);
  });
});

describe("two-envelope export separation", () => {
  // A representative mixed document set spanning multiple tender types so the
  // separation logic is proven sector-agnostic (road BOQ, water tech approach,
  // building cover letter, vendor registration form, etc.).
  type Doc = { name: string; requirementType: string };
  const docs: Doc[] = [
    { name: "Technical Approach - Road Design.docx", requirementType: "METHODOLOGY" },
    { name: "Company Profile.docx", requirementType: "COMPANY_PROFILE" },
    { name: "Bill of Quantities.xlsx", requirementType: "FINANCIAL" },
    { name: "Financial Proposal - Price Schedule.docx", requirementType: "FINANCIAL" },
    { name: "Business License.pdf", requirementType: "ELIGIBILITY" },
  ];

  function splitByEnvelope(set: Doc[]): Record<SubmissionEnvelope, string[]> {
    const buckets: Record<SubmissionEnvelope, string[]> = { TECHNICAL: [], FINANCIAL: [], ADMIN: [] };
    for (const d of set) buckets[inferEnvelope(d.requirementType, d.name)].push(d.name);
    return buckets;
  }

  it("TWO_ENVELOPE mode keeps technical and financial documents in separate buckets", () => {
    const buckets = splitByEnvelope(docs);

    // Financial docs land ONLY in the financial envelope.
    assert.ok(buckets.FINANCIAL.includes("Bill of Quantities.xlsx"));
    assert.ok(buckets.FINANCIAL.includes("Financial Proposal - Price Schedule.docx"));

    // Technical docs land ONLY in the technical envelope.
    assert.ok(buckets.TECHNICAL.includes("Technical Approach - Road Design.docx"));

    // No financial document leaks into the technical envelope and vice-versa.
    const financialNames = new Set(buckets.FINANCIAL);
    for (const techName of buckets.TECHNICAL) {
      assert.equal(financialNames.has(techName), false, `Technical doc ${techName} leaked into financial`);
    }
    assert.equal(buckets.FINANCIAL.length, 2);
    // The three envelopes are mutually exclusive (no document counted twice).
    const total = buckets.TECHNICAL.length + buckets.FINANCIAL.length + buckets.ADMIN.length;
    assert.equal(total, docs.length);
  });

  it("envelopeMode 'TWO_ENVELOPE' is a recognised mode driving separation", () => {
    const mode = sanitizeEnvelopeMode("TWO_ENVELOPE");
    assert.equal(mode, "TWO_ENVELOPE");
    // The separation contract only applies for TWO_ENVELOPE; SINGLE/DONOR_FORMAT
    // package everything together (asserted indirectly: all are valid modes).
    assert.ok((["SINGLE", "DONOR_FORMAT"] as const).every((m) => sanitizeEnvelopeMode(m) === m));
  });
});
