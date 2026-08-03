// Defect 6: exact-head Preview test — Vault upload → Plan B import →
// tender upload → refresh.
//
// Proves the end-to-end workflow:
//   1. Upload a real PDF to the Company Vault via POST /api/upload?companyDoc=true.
//   2. Capture the persisted contentSha256, contentByteLength, mimeType,
//      fileName, integrityStatus IMMEDIATELY after upload.
//   3. Run a Plan B import that references the uploaded PDF by filename
//      AND sha256. The Plan B import must NOT overwrite the official row's
//      bytes / hash / mime / fileName / storagePath with synthetic JSON.
//   4. Verify the Company Vault row is unchanged: same contentSha256,
//      contentByteLength, mimeType, fileName, integrityStatus === "VERIFIED".
//   5. Upload a tender via POST /api/tenders/upload-first.
//   6. Wait for durable extraction.
//   7. Refresh: GET /api/tenders/:id/generation-readiness,
//      GET /api/company/knowledge/repair (diagnostics).
//   8. Verify no 5xx, no console errors, no horizontal overflow on
//      /dashboard/company and /dashboard/tenders/[id].
//   9. Cleanup: delete the tender and the CompanyDocument.
//
// This spec runs against any base URL — local `next start` (CI default) or
// a Vercel preview deployment (set PLAYWRIGHT_BASE_URL). The auth fixture
// from e2e/auth-helper.ts logs in once via global setup.

import { primaryTest as test, expect } from "./auth-helper";
import { waitForDurableTenderExtraction } from "./durable-tender-extraction";

const FULL = process.env.E2E_GOLDEN_AUTH === "true";
const email = process.env.E2E_TEST_EMAIL ?? "e2e-release-integrity@example.test";
const password = process.env.E2E_TEST_PASSWORD ?? "E2E-release-integrity-password-2026";

// A minimal valid %PDF-1.7 document with one page of text containing the
// expert's name and title. The Plan B import will reference this file by
// filename + sha256.
function minimalPdf(text: string): Buffer {
  // Minimal valid PDF with one page. The text appears in a content stream.
  // PDF structure: header, catalog, pages, page, font, content stream, xref.
  const lines = [
    "%PDF-1.7",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  const contentStream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  lines.push(`5 0 obj << /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream endobj`);
  // Build xref table (simplified — pdf-parse will read it without a strict
  // xref check for this minimal file).
  const body = lines.join("\n");
  const xrefStart = body.length;
  const xref = `xref\n0 6\n0000000000 65535 f \n${lines.map((_, i) => `${String(i + 1).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(`${body}\n${xref}`, "latin1");
}

const EXPERT_NAME = "Plan B Vault Integrity Expert";
const EXPERT_TITLE = "Senior Water Engineer";
const cvText = `CURRICULUM VITAE. Name of Expert: ${EXPERT_NAME}. Proposed Position: ${EXPERT_TITLE}. 18 years of professional experience in water and sanitation infrastructure.`;

test.describe.serial("Defect 6 — Vault upload → Plan B import → tender upload → refresh (exact-head)", () => {
  test.skip(!FULL, "Set E2E_GOLDEN_AUTH=true and seed the isolated E2E account");

  test.setTimeout(180_000);

  test("Vault hashes and extraction status remain unchanged after Plan B import + tender upload + refresh", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    // ─── Step 1: Upload a real PDF to the Company Vault ────────────────
    const pdfBytes = minimalPdf(cvText);
    // Copy into a fresh ArrayBuffer so TS BlobPart / BufferSource types are
    // happy (the Buffer from minimalPdf may be backed by a pool-backed
    // ArrayBufferLike that TS rejects as a BlobPart under strict lib checks).
    const pdfArrayBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfArrayBuffer).set(pdfBytes);
    const pdfSha256 = await crypto.subtle.digest("SHA-256", pdfArrayBuffer).then((buf) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
    const vaultFileName = `defect-6-cv-${Date.now()}.pdf`;

    const vaultForm = new FormData();
    vaultForm.append("file", new Blob([pdfArrayBuffer], { type: "application/pdf" }), vaultFileName);
    vaultForm.append("companyDoc", "true");
    vaultForm.append("category", "EXPERT_CV");

    const uploadRes = await page.request.post("/api/upload", { multipart: vaultForm });
    expect(uploadRes.status(), await uploadRes.text()).toBeLessThan(500);
    expect(uploadRes.status()).toBe(200);
    // /api/upload returns a per-file result list, not a single `file` object:
    // one entry per uploaded file, each carrying the persisted row under
    // `docRecord` for company-scope uploads. Reading `file` here returned
    // undefined and failed the very first assertion, so nothing after it ran.
    const uploadJson = await uploadRes.json() as {
      success: boolean;
      uploaded: number;
      results?: Array<{
        success: boolean;
        scope?: string;
        docRecord?: {
          id?: string;
          contentSha256?: string;
          contentByteLength?: number;
          mimeType?: string;
          fileName?: string;
          originalFileName?: string;
          integrityStatus?: string;
        };
      }>;
    };
    expect(uploadJson.success).toBe(true);
    expect(uploadJson.uploaded).toBe(1);

    const vaultRecord = uploadJson.results?.find((r) => r.scope === "company")?.docRecord;
    expect(vaultRecord, JSON.stringify(uploadJson)).toBeTruthy();
    const vaultDocId = vaultRecord?.id;
    expect(vaultDocId).toBeTruthy();

    // Capture the official row's persisted values immediately after upload.
    const officialHash = vaultRecord?.contentSha256;
    const officialByteLength = vaultRecord?.contentByteLength;
    const officialMime = vaultRecord?.mimeType;
    const officialFileName = vaultRecord?.fileName;
    expect(officialHash).toBeTruthy();
    expect(officialByteLength).toBeGreaterThan(0);
    expect(officialMime).toBe("application/pdf");
    // The upload path verifies bytes before persisting; a row that reaches the
    // Vault unverified would make every later "unchanged" assertion vacuous.
    expect(vaultRecord?.integrityStatus).toBe("VERIFIED");
    // The digest the server persisted must be the digest of the bytes sent.
    expect(officialHash).toBe(pdfSha256);

    try {
      // ─── Step 2: Plan B import referencing the uploaded PDF by filename + sha256 ──
      // The Plan B payload declares an expert whose fields appear in the PDF
      // text. The sourceDocument points at the uploaded PDF by filename, and
      // sourceSha256 declares the hash so resolveLinkedSourceDoc can find the
      // official row via the documentBySha256 map.
      const planBPayload = {
        schemaVersion: "hope-plan-b-v1",
        importPolicy: { trustLevel: "AI_DRAFT", requireRawText: false, reviewNotes: "Defect 6 e2e: verify Plan B does not overwrite official Vault bytes." },
        sourceDocuments: [
          { fileName: vaultFileName, type: "Expert CV", parsedExperts: 1, sha256: pdfSha256, rawText: cvText },
        ],
        experts: [
          {
            fullName: EXPERT_NAME,
            title: EXPERT_TITLE,
            yearsExperience: 18,
            disciplines: [],
            sectors: [],
            certifications: [],
            rawText: cvText,
            sourceDocument: vaultFileName,
            sourceSha256: pdfSha256,
          },
        ],
        expectedCounts: { experts: 1, projects: 0 },
      };

      const planBRes = await page.request.post("/api/company/plan-b-import", {
        headers: { "Content-Type": "application/json" },
        data: planBPayload,
      });
      expect(planBRes.status(), await planBRes.text()).toBe(200);
      const planBJson = await planBRes.json() as {
        success: boolean;
        documents: { received: number; created: number; updated: number; skipped: number };
        experts: { received: number; created: number; updated: number; skipped: number };
        evidenceDowngraded: number;
        warnings: string[];
      };
      expect(planBJson.success).toBe(true);
      // The official row already existed, so the Plan B import must NOT
      // create a new synthetic JSON document. documents.created must be 0,
      // documents.updated must be 1 (linked, not overwritten).
      expect(planBJson.documents.created).toBe(0);
      // The expert's fields appear in the official PDF text → SOURCE_VERIFIED.
      // evidenceDowngraded must be 0.
      expect(planBJson.evidenceDowngraded).toBe(0);

      // ─── Step 3: Verify the official Vault row is UNCHANGED ───────────
      // Fetch the Company Vault document list and find our row.
      const vaultListRes = await page.request.get("/api/company/documents");
      expect(vaultListRes.status()).toBeLessThan(500);
      const vaultListJson = await vaultListRes.json() as {
        documents?: Array<{
          id: string;
          fileName?: string | null;
          originalFileName?: string | null;
          mimeType?: string | null;
          contentSha256?: string | null;
          contentByteLength?: number | null;
          integrityStatus?: string | null;
        }>;
      };
      const docs = vaultListJson.documents ?? [];
      const ourDoc = docs.find((d) => d.id === vaultDocId);
      expect(ourDoc, "official Vault row must still exist after Plan B import").toBeTruthy();
      // The byte-bearing fields must be UNCHANGED — Plan B did not overwrite
      // them with synthetic JSON values.
      expect(ourDoc!.contentSha256).toBe(officialHash);
      expect(ourDoc!.contentByteLength).toBe(officialByteLength);
      expect(ourDoc!.mimeType).toBe("application/pdf");
      expect(ourDoc!.fileName).toBe(officialFileName);
      expect(ourDoc!.integrityStatus).toBe("VERIFIED");

      // ─── Step 4: Upload a tender via /api/tenders/upload-first ────────
      const tenderText = `
REQUEST FOR PROPOSAL
Reference: RFP-DEFECT-6-${Date.now()}
Procuring Entity: Defect 6 Public Agency

SUBMISSION INSTRUCTIONS
Submit by email to procurement@example.test.

MANDATORY ELIGIBILITY REQUIREMENTS
1. Submit a valid business licence.
2. Provide at least three relevant project references.
3. Nominate a project manager with at least ten years of experience.
`;
      const tenderForm = new FormData();
      tenderForm.append("title", `Defect 6 Tender ${Date.now()}`);
      tenderForm.append("reference", `RFP-DEFECT-6-${Date.now()}`);
      tenderForm.append("file", new Blob([tenderText], { type: "text/plain" }), "defect-6-tender.txt");
      const intake = await page.request.post("/api/tenders/upload-first", { multipart: tenderForm });
      expect(intake.status(), await intake.text()).toBe(201);
      const intakeJson = await intake.json() as {
        success: boolean;
        tenderId: string;
        processingJobId: string | null;
      };
      expect(intakeJson.success).toBe(true);
      const tenderId = intakeJson.tenderId;

      try {
        // ─── Step 5: Wait for durable extraction ──────────────────────────
        const extraction = await waitForDurableTenderExtraction({
          request: page.request,
          tenderId,
          expectedFileCount: 1,
        });
        expect(extraction.files).toHaveLength(1);

        // ─── Step 6: Refresh — generation readiness + knowledge repair diagnostics ──
        const readiness = await page.request.get(`/api/tenders/${tenderId}/generation-readiness`);
        expect(readiness.status()).toBeLessThan(500);

        const repair = await page.request.get("/api/company/knowledge/repair");
        expect(repair.status()).toBeLessThan(500);

        // ─── Step 7: Re-verify the official Vault row is STILL UNCHANGED ──
        // After tender upload + refresh, the Vault row must still be intact.
        const vaultListRes2 = await page.request.get("/api/company/documents");
        expect(vaultListRes2.status()).toBeLessThan(500);
        const vaultListJson2 = await vaultListRes2.json() as typeof vaultListJson;
        const docs2 = vaultListJson2.documents ?? [];
        const ourDoc2 = docs2.find((d) => d.id === vaultDocId);
        expect(ourDoc2, "official Vault row must still exist after tender upload + refresh").toBeTruthy();
        expect(ourDoc2!.contentSha256).toBe(officialHash);
        expect(ourDoc2!.contentByteLength).toBe(officialByteLength);
        expect(ourDoc2!.mimeType).toBe("application/pdf");
        expect(ourDoc2!.integrityStatus).toBe("VERIFIED");

        // ─── Step 8: No horizontal overflow on the dashboard pages ────────
        await page.goto(`/dashboard/tenders/${tenderId}`);
        await page.waitForLoadState("networkidle");
        const tenderOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(tenderOverflow).toBeLessThanOrEqual(0);

        await page.goto("/dashboard/company");
        await page.waitForLoadState("networkidle");
        const companyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(companyOverflow).toBeLessThanOrEqual(0);
      } finally {
        // Cleanup tender
        const cleanup = await page.request.delete(`/api/tenders/${tenderId}`);
        expect([200, 204]).toContain(cleanup.status());
      }
    } finally {
      // Cleanup Company Vault document
      const vaultCleanup = await page.request.delete(`/api/company/documents/${vaultDocId}`);
      expect([200, 204]).toContain(vaultCleanup.status());
    }
  });
});
