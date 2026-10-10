import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { __testing__ as missingPlanTesting } from "../lib/engine/missing-plan-file-generation";
import { generatedDocumentVisibleText } from "../lib/engine/generated-document-text";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";
import { containsMetadataScaffolding } from "../lib/engine/metadata-validators";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

const METHODOLOGY_NAME = "Technical Approach and Methodology.docx";

describe("standalone methodology planned-file regression", () => {
  it("generates a real methodology that clears the existing length and section gates", async () => {
    const requirements = [
      { title: "Technical Approach and Methodology", description: "Explain the proposed approach and execution method.", priority: "MANDATORY" },
      { title: "Quality Assurance and Quality Control", description: "Describe the quality review process.", priority: "MANDATORY" },
      { title: "Risk Management Plan", description: "Explain material risks and mitigation.", priority: "MANDATORY" },
    ];
    const evidence = {
      experts: ["Abebe Tesfaye — Lead Architect | 12+ years"],
      projects: ["Hospital Design Assignment — Example Client | Ethiopia"],
    };

    const fileContent = await missingPlanTesting.methodologyNarrativeContent(
      "Architectural Consultancy Services for a Specialty Medical Center",
      METHODOLOGY_NAME,
      requirements,
      evidence,
    );
    const visibleText = await generatedDocumentVisibleText({
      fileContent,
      exactFileName: METHODOLOGY_NAME,
      name: "Technical Approach and Methodology",
      contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    assert.ok(visibleText, "generated methodology DOCX must have inspectable text");

    const report = assessGeneratedDocumentQuality({
      doc: {
        name: "Technical Approach and Methodology",
        exactFileName: METHODOLOGY_NAME,
        documentType: "METHODOLOGY",
        format: "DOCX",
      },
      visibleText,
      rawFileContent: fileContent,
      requirements,
      selectedExpertNames: ["Abebe Tesfaye"],
      selectedProjectNames: ["Hospital Design Assignment"],
    });

    assert.ok(report.wordCount >= 800, `expected >=800 words, got ${report.wordCount}`);
    assert.deepEqual(report.missingRequiredSections, []);
    assert.equal(report.requirementCoverageRatio, 1);
    assert.equal(report.recommendedStatus, "PASSED", JSON.stringify(report.issues));
  });

  it("does not report 100% coverage when required methodology sections are absent", () => {
    const requirements = [
      { title: "Technical Approach and Methodology", description: null, priority: "MANDATORY" },
    ];
    const visibleText = [
      "Subject: Technical Approach and Methodology",
      "Technical Approach and Methodology",
      "This short draft repeats the extracted requirement but contains none of the required execution structure.",
    ].join("\n");

    const report = assessGeneratedDocumentQuality({
      doc: {
        name: "Technical Approach and Methodology",
        exactFileName: METHODOLOGY_NAME,
        documentType: "METHODOLOGY",
        format: "DOCX",
      },
      visibleText,
      requirements,
    });

    assert.equal(report.missingRequiredSections.length, 6);
    assert.equal(report.requirementCoverageRatio, 0);
  });
});

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t-scaffold",
    title: "Test Tender",
    reference: "REF-001",
    clientName: "Pharo Ventures",
    procuringEntityName: null,
    deadline: new Date("2026-12-11"),
    currency: "USD",
    country: "Ethiopia",
    submissionMethod: "Email",
    submissionAddress: "test@example.com",
    submissionEmails: "test@example.com",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Pharo Ventures",
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Submit by email",
    submissionAddressSourcePage: 2,
    submissionAddressSourceQuote: "test@example.com",
    submissionEmailSourcePage: 2,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

describe("extractor-scaffolding metadata regression", () => {
  it("detects multi-field labels and extractor self-instructions", () => {
    assert.equal(
      containsMetadataScaffolding("Pharo Ventures Procuring Entity / Client Name: Pharo Ventures Legal Client Name: Pharo Ventures Project Name: Pharo Health Ethiopia"),
      true,
    );
    assert.equal(
      containsMetadataScaffolding("/ Portal: No physical address or portal is provided. Use email submission only. Financial Proposal: Not required at this stage. Do not generate a financial proposal."),
      true,
    );
    assert.equal(
      containsMetadataScaffolding("Not mentioned. Mark as not applicable. Page Limit: Not mentioned. Mark as not found"),
      true,
    );
    assert.equal(containsMetadataScaffolding("Pharo Ventures"), false);
    assert.equal(containsMetadataScaffolding("Portal: https://procurement.example.org/tender/123"), false);
  });

  it("cannot promote a scaffolded client value to EXTRACTED_AND_GROUNDED even with matching source evidence", () => {
    const contaminated = "Pharo Ventures Procuring Entity / Client Name: Pharo Ventures Legal Client Name: Pharo Ventures Project Name: Pharo Health Ethiopia Specialty Medical Center";
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: contaminated,
        clientNameSourcePage: 1,
        clientNameSourceQuote: contaminated,
      }),
      overrides: [],
      hasExtractedRequirements: true,
    });
    const field = result.fields.find((item) => item.fieldKey === "clientName");
    assert.ok(field);
    assert.notEqual(field.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(field.isValid, false);
    assert.match(field.blockerReason ?? "", /scaffolding|extraction instructions/i);
  });

  it("cannot promote an extractor-instruction submission address to grounded", () => {
    const contaminated = "/ Portal: No physical address or portal is provided. Use email submission only. Financial Proposal: Not required at this stage. Do not generate a financial proposal.";
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        submissionAddress: contaminated,
        submissionAddressSourcePage: 2,
        submissionAddressSourceQuote: contaminated,
      }),
      overrides: [],
      hasExtractedRequirements: true,
    });
    const field = result.fields.find((item) => item.fieldKey === "submissionAddress");
    assert.ok(field);
    assert.notEqual(field.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(field.isValid, false);
  });
});

describe("admin audit hard-quality readiness contract", () => {
  it("source requires QUALITY_FAILED to make readyForExport false", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("app/api/admin/generated-proposals/audit/route.ts", "utf8");
    assert.match(source, /hardQualityFailure\s*=\s*qualityRecommendedStatus\s*===\s*"QUALITY_FAILED"/);
    assert.match(source, /readyForExport[^;]+&&\s*!hardQualityFailure/);
  });
});
