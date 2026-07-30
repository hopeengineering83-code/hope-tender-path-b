import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { redactVaultText, safeVaultFileLabel } from "../lib/vault-review-provenance";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Company Vault automatic verification contract", () => {
  it("redacts identifiers, paths, object URLs, and registration values", () => {
    const raw = "Email jane@example.com phone +251 911 223344 DOB: 1990-01-01 Nationality: Ethiopian License No: ABC-1234 /home/user/private/cv.pdf s3://secret-bucket/key";
    const redacted = redactVaultText(raw, 220);
    assert.doesNotMatch(redacted, /jane@example\.com/i);
    assert.doesNotMatch(redacted, /911 223344/);
    assert.doesNotMatch(redacted, /1990-01-01/);
    assert.doesNotMatch(redacted, /Ethiopian/i);
    assert.doesNotMatch(redacted, /ABC-1234/i);
    assert.doesNotMatch(redacted, /\/home\/user\/private/);
    assert.doesNotMatch(redacted, /s3:\/\//i);
  });

  it("uses privacy-safe source labels instead of original filenames", () => {
    const label = safeVaultFileLabel("EXPERT_CV", 2);
    assert.equal(label, "Expert Cv document 3");
    assert.doesNotMatch(label, /\.pdf|john|jane/i);
  });

  it("has one canonical Automatic Verification route and redirects the legacy review board", () => {
    const page = read("app/dashboard/company/review/page.tsx");
    const view = read("components/company-vault-verification-page.tsx");
    const legacy = read("app/dashboard/company/review-board/page.tsx");
    const subnav = read("components/company-subnav.tsx");
    const generationReadiness = read("components/generation-readiness-panel.tsx");
    const planBImport = read("app/dashboard/company/plan-b-import/page.tsx");
    const deepReasoning = read("lib/engine/deep-reasoning-readiness.ts");

    assert.match(page, /company-vault-verification-page/);
    assert.match(view, /Automatic Verification/);
    assert.match(view, /SOURCE_VERIFIED/);
    assert.match(view, /No human approval step is required/);
    assert.match(legacy, /redirect\("\/dashboard\/company\/review"\)/);
    assert.doesNotMatch(legacy, /fetch\s*\(|method:\s*"PATCH"|method:\s*"POST"/);
    assert.equal((subnav.match(/href: "\/dashboard\/company\/review"/g) ?? []).length, 1);
    assert.match(subnav, /href: "\/dashboard\/company\/review", label: "Automatic Verification"/);
    assert.doesNotMatch(subnav, /label: "Review Inbox"|href: "\/dashboard\/company\/review-board"/);
    assert.doesNotMatch(generationReadiness, /\/dashboard\/company\/review-board|Open review board/);
    assert.doesNotMatch(planBImport, /\/dashboard\/company\/review-board|>Review Board</);
    assert.doesNotMatch(deepReasoning, /\/dashboard\/company\/review-board/);
  });

  it("returns bounded diagnostics without exposing raw source narratives", () => {
    const api = read("app/api/company/knowledge/repair/route.ts");
    const view = read("components/company-vault-verification-page.tsx");

    assert.match(api, /const RECORD_PAGE_SIZE = 10/);
    assert.match(api, /skip:\s*\(pagination\.expertPage - 1\) \* RECORD_PAGE_SIZE/);
    assert.match(api, /skip:\s*\(pagination\.projectPage - 1\) \* RECORD_PAGE_SIZE/);
    assert.match(api, /take:\s*RECORD_PAGE_SIZE/g);
    assert.match(api, /redactVaultText\(expert\.fullName/);
    assert.match(api, /safeVaultFileLabel\(doc\.category, index\)/);
    assert.doesNotMatch(view, /sourceSnippet|expert\.profile|project\.summary|originalFileName|storagePath|extractedText/);
    assert.match(view, /Evidence gaps/);
  });

  it("uses complete owned-source records for durable trust", () => {
    const provenance = read("lib/vault-review-provenance.ts");
    const api = read("app/api/company/knowledge/repair/route.ts");

    assert.match(provenance, /VAULT_REVIEW_CONSUMER_SELECT/);
    assert.match(provenance, /certifications: true/);
    assert.match(provenance, /serviceAreas: true/);
    assert.match(provenance, /contractValue: true/);
    assert.match(provenance, /contentSha256: true/);
    assert.match(provenance, /contentByteLength: true/);
    assert.match(provenance, /integrityStatus: true/);
    assert.match(provenance, /record\.sourceDocument\.companyId !== record\.companyId/);
    assert.match(provenance, /currentValueHashes\.get\(item\.field\) === item\.valueHash/);
    assert.match(api, /VAULT_REVIEW_CONSUMER_SELECT\.EXPERT/);
    assert.match(api, /VAULT_REVIEW_CONSUMER_SELECT\.PROJECT/);
  });

  it("verifies uploaded bytes before Company Vault persistence", () => {
    const uploadRoute = read("app/api/upload/route.ts");
    const secureUpload = read("lib/secure-upload-handler.ts");
    const byteIntegrity = read("lib/engine/persisted-byte-integrity.ts");

    assert.match(uploadRoute, /return handleSecureUpload\(req\)/);
    assert.match(secureUpload, /Buffer\.from\(await file\.arrayBuffer\(\)\)/);
    assert.match(secureUpload, /inspectActualFileBytes/);
    assert.match(secureUpload, /integrity\.integrityStatus !== "VERIFIED"/);
    assert.ok(secureUpload.indexOf("inspectActualFileBytes") < secureUpload.indexOf("storage.putFile"));
    assert.match(byteIntegrity, /contentSha256: computeByteSha256\(bytes\)/);
    assert.match(byteIntegrity, /contentByteLength: bytes\.length/);
  });

  it("keeps optional human audit truthful when used", () => {
    for (const [kind, source] of [
      ["EXPERT", read("app/api/company/experts/batch/route.ts")],
      ["PROJECT", read("app/api/company/projects/batch/route.ts")],
    ] as const) {
      assert.match(source, /buildReviewProvenance/);
      assert.match(source, new RegExp(`recordType: "${kind}"`));
      assert.match(source, /reviewerId:\s*actor\.id/);
      assert.match(source, /reviewedBy:\s*actor\.id/);
      assert.match(source, /reviewNotes:\s*candidate\.serialized/);
      assert.match(source, /missingEvidenceFields/);
      assert.match(source, /await tx\.auditLog\.create/);
    }
  });

  it("preserves uncertain mixed-document records for automatic reprocessing", () => {
    const cleanup = read("lib/company-support-doc-cleanup.ts");
    const view = read("components/company-vault-verification-page.tsx");
    assert.match(cleanup, /never destroys them/i);
    assert.match(cleanup, /expertsDeleted:\s*0/);
    assert.match(cleanup, /projectsDeleted:\s*0/);
    assert.match(view, /Reprocess and verify/);
  });
});
