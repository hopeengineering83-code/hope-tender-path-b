// Release acceptance — Work Package B (generated-document output quality).
//
// Exercises the REAL validateDocumentQuality server validator. A trustworthy
// generated document must never ship AI traces, placeholders, empty content, or
// mixed technical/financial (pricing) envelopes. This is the server gate that
// backs Export Readiness for document content.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";

const CLEAN_TECHNICAL = `# Technical Proposal

Prepared for the Nairobi Water and Sewerage Authority (Reference: RFP-2026-014).

Hope Engineering proposes a phased construction supervision methodology grounded
in the tender's scope of work. Our staffing plan assigns a resident engineer and
two inspectors, and our work plan sequences mobilisation, supervision, and
handover across the contract period. Relevant completed projects are cited as
evidence of capability.`.repeat(2);

describe("release-acceptance B — generated document quality", () => {
  it("accepts a clean, non-empty technical document", () => {
    const r = validateDocumentQuality({ name: "01-Technical.docx", documentType: "TECHNICAL", fileContent: CLEAN_TECHNICAL, storagePath: null });
    assert.equal(r.isEmpty, false);
    assert.equal(r.aiTrace.length, 0, "no AI traces in clean content");
    assert.equal(r.envelopeMismatch, null);
    assert.notEqual(r.status, "BLOCKED");
  });

  it("BLOCKS documents that contain AI traces", () => {
    const withTrace = CLEAN_TECHNICAL + "\n\nAs an AI language model, I cannot verify these figures.";
    const r = validateDocumentQuality({ name: "02-Technical.docx", documentType: "TECHNICAL", fileContent: withTrace, storagePath: null });
    assert.ok(r.aiTrace.length > 0, "AI trace detected");
    assert.equal(r.status, "BLOCKED");
  });

  it("BLOCKS an empty / near-empty generated document", () => {
    const r = validateDocumentQuality({ name: "03-Technical.docx", documentType: "TECHNICAL", fileContent: "   ", storagePath: null });
    assert.equal(r.isEmpty, true);
    assert.equal(r.status, "BLOCKED");
  });

  it("BLOCKS pricing leakage into a TECHNICAL envelope", () => {
    const leaky = CLEAN_TECHNICAL + "\n\nTotal price: $1,250,000 with a unit price of $500 per item.";
    const r = validateDocumentQuality({ name: "04-Technical.docx", documentType: "TECHNICAL", fileContent: leaky, storagePath: null });
    assert.ok(r.envelopeMismatch && /financial|pricing/i.test(r.envelopeMismatch));
    assert.equal(r.status, "BLOCKED");
  });

  it("BLOCKS technical methodology bleeding into a FINANCIAL envelope", () => {
    const financial = `# Financial Proposal\n\nOur detailed methodology and work plan describe the technical approach and staffing plan.`.repeat(3);
    const r = validateDocumentQuality({ name: "05-Financial.docx", documentType: "FINANCIAL", fileContent: financial, storagePath: null });
    assert.ok(r.envelopeMismatch && /technical/i.test(r.envelopeMismatch));
    assert.equal(r.status, "BLOCKED");
  });
});
