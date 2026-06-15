import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateDocumentQuality } from "../../lib/engine/quality/document-quality-validator";

describe("Tender Regression Tests (Phase 7)", () => {
  describe("Document Quality Validator", () => {
    it("should block documents with placeholders", () => {
      const doc = {
        name: "Test Doc",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "This is a proposal with [insert name here] placeholder.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.equal(result.status, "BLOCKED");
      // Validator strips special regex chars from the name it returns,
      // but we should still find the core intent.
      assert.ok(result.placeholders[0].includes("insert"));
    });

    it("should block documents with AI traces", () => {
      const doc = {
        name: "Test Doc",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "As an AI language model, I cannot provide this info.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.equal(result.status, "BLOCKED");
      assert.ok(result.aiTrace.includes("as an ai"));
    });

    it("should detect envelope mismatch: financial in technical", () => {
      const doc = {
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "Our methodology is great. The total price is 500,000 USD.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.equal(result.status, "BLOCKED");
      assert.ok(result.envelopeMismatch?.includes("Financial pricing content"));
    });

    it("should detect envelope mismatch: technical in financial", () => {
      const doc = {
        name: "Financial Proposal",
        documentType: "FINANCIAL_PROPOSAL",
        fileContent: "Price schedule: $100. Our technical methodology is based on ISO standards.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.equal(result.status, "BLOCKED");
      assert.ok(result.envelopeMismatch?.includes("Technical methodology content"));
    });

    it("should pass clean documents", () => {
      const doc = {
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "We will use a staged approach for the design phase, focusing on sustainable materials and safety. " +
                     "This comprehensive methodology ensures that all project milestones are met on time and within the specified budget constraints. " +
                     "Our team of experts will coordinate closely with the client to deliver high-quality architectural drawings and structural analysis " +
                     "that comply with all local building codes and international best practices. We are committed to excellence in every aspect of this building design tender.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.equal(result.status, "GOOD");
      assert.equal(result.score, 100);
    });

    it("FINANCIAL_IN_TECHNICAL_RE false-positive fix: prose 'total price of the contract was fair' does NOT trigger", () => {
      const doc = {
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "The methodology was sound and the total price of the contract was fair given the scope of work. " +
                     "Our approach focuses on quality deliverables and stakeholder engagement throughout the engagement. " +
                     "We will deploy qualified experts with relevant experience to ensure successful project delivery.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.equal(result.envelopeMismatch, null, "Prose 'total price of the contract was fair' must not trigger PRICING_IN_TECHNICAL false positive");
      assert.notEqual(result.status, "BLOCKED", "Document should not be BLOCKED on a prose reference to price");
    });

    it("FINANCIAL_IN_TECHNICAL_RE: 'total price: $50,000' in a TECHNICAL doc DOES trigger", () => {
      const doc = {
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "Our team has strong methodology. Total price: $50,000 for the full scope.",
        storagePath: null,
      };
      const result = validateDocumentQuality(doc);
      assert.ok(result.envelopeMismatch?.includes("Financial pricing content"), "Numeric total price must still flag envelope mismatch");
    });
  });
});
