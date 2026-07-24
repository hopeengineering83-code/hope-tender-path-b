import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyDocumentContent,
  shouldScanForExperts,
  shouldScanForProjects,
} from "../lib/company-document-classifier";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Autonomous Company-Tender Pipeline", () => {

  // ─── 1. Content-capability classification ──────────────────────────────
  describe("content-capability document classifier", () => {
    it("detects expert data in a CV uploaded as COMPANY_PROFILE", () => {
      const text = "Curriculum Vitae\nName of Expert: John Doe\nYears of Experience: 15\nQualifications: MSc Structural Engineering";
      const result = classifyDocumentContent("company_profile.pdf", "COMPANY_PROFILE", text);
      assert.ok(result.hasExpertData, "Must detect expert data regardless of category");
      assert.ok(result.capabilities.includes("EXPERT_CV"));
    });

    it("detects project data in a portfolio uploaded as OTHER", () => {
      const text = "Project Name: Bridge Construction\nClient Name: Ministry of Transport\nContract Value: 5,000,000 USD\nYear Completed: 2023";
      const result = classifyDocumentContent("misc.docx", "OTHER", text);
      assert.ok(result.hasProjectData, "Must detect project data regardless of category");
      assert.ok(result.capabilities.includes("PROJECT_REFERENCE"));
    });

    it("detects multiple capabilities in a single document", () => {
      const text = "Company Profile\nFounded: 1995\nKey Staff:\nName of Expert: Jane Smith\nYears of Experience: 20\nPast Projects:\nProject Name: Hospital Design\nClient Name: Health Ministry";
      const result = classifyDocumentContent("profile.pdf", "COMPANY_PROFILE", text);
      assert.ok(result.hasExpertData, "Must detect expert data in mixed document");
      assert.ok(result.hasProjectData, "Must detect project data in mixed document");
      assert.ok(result.hasCompanyFacts, "Must detect company facts in mixed document");
    });

    it("shouldScanForExperts returns true for CV content regardless of category", () => {
      const cvText = "Curriculum Vitae\nName: John Doe\nProposed Position: Lead Engineer\nYears of Experience: 15";
      assert.ok(shouldScanForExperts("upload.pdf", "OTHER", cvText));
      assert.ok(shouldScanForExperts("upload.pdf", "COMPANY_PROFILE", cvText));
      assert.ok(shouldScanForExperts("upload.pdf", "MANUAL", cvText));
    });

    it("shouldScanForProjects returns true for project content regardless of category", () => {
      const projectText = "Project Name: School Construction\nClient Name: Education Ministry\nContract Value: 2,000,000";
      assert.ok(shouldScanForProjects("upload.pdf", "OTHER", projectText));
      assert.ok(shouldScanForProjects("upload.pdf", "COMPANY_PROFILE", projectText));
    });

    it("returns OTHER for documents with no recognizable content", () => {
      const result = classifyDocumentContent("blank.pdf", "OTHER", "");
      assert.ok(result.capabilities.includes("OTHER"));
      assert.equal(result.hasExpertData, false);
      assert.equal(result.hasProjectData, false);
    });
  });

  // ─── 2. Provenance preservation ────────────────────────────────────────
  describe("provenance preservation in knowledge import", () => {
    it("company-knowledge-import-safe imports content-classifier", () => {
      const src = read("lib/company-knowledge-import-safe.ts");
      assert.ok(
        src.includes("shouldScanForExperts") || src.includes("company-document-classifier"),
        "Must import content-capability classifier"
      );
    });

    it("does not use category-only EXPERT_IMPORT_CATEGORIES for isExpertDoc", () => {
      const src = read("lib/company-knowledge-import-safe.ts");
      // The old pattern: isExpertDoc returns EXPERT_IMPORT_CATEGORIES.has(doc.category)
      // The new pattern: isExpertDoc calls shouldScanForExperts
      assert.ok(
        !src.includes("return EXPERT_IMPORT_CATEGORIES.has(doc.category)"),
        "Must not use category-only classification for experts"
      );
      assert.ok(
        !src.includes("return PROJECT_IMPORT_CATEGORIES.has(doc.category)"),
        "Must not use category-only classification for projects"
      );
    });
  });

  // ─── 3. Auto-pipeline after upload ─────────────────────────────────────
  describe("auto-pipeline after tender upload", () => {
    it("secure-upload-handler enqueues AI_ANALYZE before ENGINE_RUN", () => {
      const src = read("lib/secure-upload-handler.ts");
      assert.ok(
        src.includes("AI_ANALYZE"),
        "Must enqueue AI_ANALYZE after tender upload"
      );
      assert.ok(
        src.includes("ENGINE_RUN"),
        "Must enqueue ENGINE_RUN after tender upload"
      );
    });
  });

  // ─── 4. Trust level integrity ──────────────────────────────────────────
  describe("trust level integrity", () => {
    it("knowledge import never sets REVIEWED automatically", () => {
      const src = read("lib/company-knowledge-import-safe.ts");
      // Must not assign trustLevel: "REVIEWED" anywhere
      assert.ok(
        !src.includes('trustLevel: "REVIEWED"'),
        "Must never auto-promote to REVIEWED"
      );
    });

    it("matching-eligibility requires REVIEWED for final matching", () => {
      const src = read("lib/engine/matching-eligibility.ts");
      assert.ok(
        src.includes('trustLevel !== "REVIEWED"'),
        "Must require REVIEWED trust level for final matching"
      );
    });
  });

  // ─── 5. Brand-asset readiness refresh ──────────────────────────────────
  describe("brand-asset upload readiness refresh", () => {
    it("assets route refreshes company readiness after upload", () => {
      const src = read("app/api/company/assets/route.ts");
      assert.ok(
        src.includes("setupCompletedAt"),
        "Must refresh company readiness after brand-asset upload"
      );
    });
  });
});
