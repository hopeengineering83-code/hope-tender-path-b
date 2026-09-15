import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveQuotedSourceDocument, type VaultDocument } from "../lib/company-vault-ingestion";

function doc(id: string, fileName: string, category: string, extractedText: string): VaultDocument {
  return {
    id,
    originalFileName: fileName,
    category,
    mimeType: "text/plain",
    extractedText,
    integrityStatus: "VERIFIED",
  };
}

describe("Company Vault AI source quote authority", () => {
  const expertQuote = "Dawit Bekele — Senior Engineer — proposed position Team Leader";
  const projectQuote = "Project Reference 1 — Ethiopia — similar assignment";

  it("prefers a dedicated CV over a generic profile when both contain the exact expert quote", () => {
    const profile = doc("profile", "company-profile.txt", "COMPANY_PROFILE", `COMPANY PROFILE\n${expertQuote}\nSummary only.`);
    const cv = doc("cv", "detailed-cvs.txt", "EXPERT_CV", `DETAILED CURRICULUM VITAE\n${expertQuote}\nFull professional history.`);
    assert.equal(resolveQuotedSourceDocument([profile, cv], expertQuote, "EXPERT")?.id, "cv");
    assert.equal(resolveQuotedSourceDocument([cv, profile], expertQuote, "EXPERT")?.id, "cv",
      "database/list order must not change the selected authority");
  });

  it("prefers a dedicated project reference over a generic profile for the same exact project quote", () => {
    const profile = doc("profile", "company-profile.txt", "COMPANY_PROFILE", `COMPANY PROFILE\n${projectQuote}\nSummary only.`);
    const reference = doc("project", "company-projects.txt", "PROJECT_REFERENCE", `PROJECT REFERENCES\n${projectQuote}\nDetailed assignment record.`);
    assert.equal(resolveQuotedSourceDocument([profile, reference], projectQuote, "PROJECT")?.id, "project");
  });

  it("fails closed when two strongest dedicated documents are indistinguishable", () => {
    const a = doc("a", "cv-a.txt", "EXPERT_CV", `CURRICULUM VITAE\n${expertQuote}\nAuthenticated source A.`);
    const b = doc("b", "cv-b.txt", "EXPERT_CV", `CURRICULUM VITAE\n${expertQuote}\nAuthenticated source B.`);
    assert.equal(resolveQuotedSourceDocument([a, b], expertQuote, "EXPERT"), null);
  });

  it("requires a genuine quote binding and does not select a category alone", () => {
    const cv = doc("cv", "detailed-cvs.txt", "EXPERT_CV", "CURRICULUM VITAE\nA completely different expert appears in this source.");
    assert.equal(resolveQuotedSourceDocument([cv], expertQuote, "EXPERT"), null);
  });
});