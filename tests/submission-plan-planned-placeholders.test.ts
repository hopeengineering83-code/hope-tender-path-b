import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSubmissionPlanCompleteness } from "../lib/engine/plans/submission-plan-completeness";

describe("submission plan completeness — planned placeholders", () => {
  it("counts PLANNED GeneratedDocument rows with no content as missing planned documents", () => {
    const report = resolveSubmissionPlanCompleteness({
      tender: {
        id: "tender-1",
        title: "Pharo Tender",
        requirements: [
          {
            id: "req-1",
            title: "Methodology, work plan and technical approach",
            description: "Submit the methodology, work plan and technical approach document.",
            requirementType: "METHODOLOGY",
            priority: "MANDATORY",
            exactFileName: "Methodology, work plan and technical approach.docx",
            exactOrder: 1,
          },
        ],
      },
      generatedDocuments: [
        {
          id: "doc-1",
          name: "Methodology, work plan and technical approach.docx",
          exactFileName: "Methodology, work plan and technical approach.docx",
          exactOrder: 1,
          documentType: "METHODOLOGY",
          format: "DOCX",
          generationStatus: "PLANNED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
          fileContent: null,
          storagePath: null,
        },
      ],
    });

    assert.equal(report.totalRequired, 1);
    assert.equal(report.totalGenerated, 0);
    assert.equal(report.totalMissing, 1);
    assert.equal(report.rows[0].status, "PLANNED");
    assert.ok(report.warnings.some((warning) => warning.includes("planned document placeholder")));
  });
});
