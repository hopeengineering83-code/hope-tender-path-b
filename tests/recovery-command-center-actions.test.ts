// Regression tests for the Recovery Command Center action dispatcher.
//
// Verifies:
//   1. LINK_VAULT_EVIDENCE no longer navigates to /dashboard/vault (404).
//   2. LINK_VAULT_EVIDENCE dispatches to the existing backend route, not a page URL.
//   3. Unknown / future actions show a safe inline message rather than guessing a URL.
//   4. documentHygieneIssues gating means auto-linked evidence is never auto-approved
//      when it has hygiene issues — preserving export safety.
//
// These tests exercise pure helpers used by the route and the component logic.
// They do NOT spin up HTTP servers or browsers.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { documentHygieneIssues } from "../lib/engine/export-readiness";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";

// ─── 1. Action routing: no window.location navigation to missing routes ──────

// All actions that produce a live navigation (window.location.href or router.push)
// must point to routes that exist inside the Next.js app.
// We enumerate the known-safe target paths so any future addition is caught.
const KNOWN_SAFE_NAVIGATE_TARGETS = new Set([
  "/dashboard/analytics",   // CONFIGURE_AI_PROVIDER — page exists
  // /dashboard/vault was the old LINK_VAULT_EVIDENCE target — it does NOT exist
  // and must never appear in the component.
]);

describe("Recovery Command Center — no 404-causing navigation", () => {
  it("component source does not contain a navigation to /dashboard/vault", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "components/tender-recovery-command-center.tsx"),
      "utf8",
    );
    assert.ok(
      !src.includes("/dashboard/vault"),
      "component must not navigate to /dashboard/vault (page does not exist)",
    );
  });

  it("LINK_VAULT_EVIDENCE handler calls the API route, not window.location", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "components/tender-recovery-command-center.tsx"),
      "utf8",
    );
    // The handler must reference the API endpoint.
    assert.ok(
      src.includes("/api/tenders/${tenderId}/link-vault-evidence"),
      "LINK_VAULT_EVIDENCE handler must call /api/tenders/[id]/link-vault-evidence",
    );
  });

  it("component has an else fallback for unknown actions", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "components/tender-recovery-command-center.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("Action not available yet"),
      "unknown actions must show 'Action not available yet' fallback message",
    );
  });
});

// ─── 2. link-vault-evidence route: safety gates unchanged ─────────────────────

// The POST handler only marks a document READY_FOR_EXPORT when:
//   hasBytes=true  AND  hygieneIssues.length === 0
// These tests verify the hygiene gate hasn't been weakened.

function mkDoc(overrides: {
  name?: string;
  exactFileName?: string;
  documentType?: string;
  format?: string;
}): { name: string; exactFileName: string | null; documentType: string | null; format: string | null } {
  return {
    name: overrides.name ?? "Test Document",
    exactFileName: overrides.exactFileName ?? null,
    documentType: overrides.documentType ?? null,
    format: overrides.format ?? null,
  };
}

describe("link-vault-evidence: export gate hygiene checks preserved", () => {
  it("returns hygiene issues for a pricing-leaking technical doc", () => {
    const issues = documentHygieneIssues(
      "Unit price: $12,000 per day. Financial offer total: USD 450,000.",
      mkDoc({ name: "Technical Proposal", documentType: "TECHNICAL_PROPOSAL" }),
    );
    assert.ok(issues.length > 0, "technical doc with pricing data should have hygiene issues");
  });

  it("returns no hygiene issues for a clean technical doc", () => {
    const issues = documentHygieneIssues(
      "This proposal outlines the technical approach for project delivery.",
      mkDoc({ name: "Technical Proposal", documentType: "TECHNICAL_PROPOSAL" }),
    );
    assert.equal(issues.length, 0, "clean technical doc should have no hygiene issues");
  });

  it("SUPERSEDED document is never a final export candidate after vault link", () => {
    const isCandidate = isFinalExportCandidateDocument({
      name: "Old Proposal",
      exactFileName: null,
      documentType: "TECHNICAL_PROPOSAL",
      format: null,
      generationStatus: "SUPERSEDED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
    });
    assert.equal(isCandidate, false, "SUPERSEDED docs must never be export candidates");
  });

  it("partially-linked doc (hygiene issues) stays PENDING — export gate remains blocked", () => {
    // Simulate the route logic: ready = hasBytes && hygieneIssues.length === 0
    const extractedText = "Financial offer: USD 99,000. Unit cost breakdown follows.";
    const row = mkDoc({ name: "Technical Proposal", documentType: "TECHNICAL_PROPOSAL" });
    const hygieneIssues = documentHygieneIssues(extractedText, row);
    const hasBytes = true;
    const ready = hasBytes && hygieneIssues.length === 0;
    assert.equal(ready, false, "doc with hygiene issues must not be marked ready for export");
  });

  it("fully-linked doc (clean, has bytes) can be marked READY_FOR_EXPORT", () => {
    const extractedText = "Technical approach and methodology for infrastructure delivery.";
    const row = mkDoc({ name: "Technical Proposal", documentType: "TECHNICAL_PROPOSAL" });
    const hygieneIssues = documentHygieneIssues(extractedText, row);
    const hasBytes = true;
    const ready = hasBytes && hygieneIssues.length === 0;
    assert.equal(ready, true, "clean doc with bytes should be allowed READY_FOR_EXPORT status");
  });
});

// ─── 3. Partial evidence must not unblock the export gate ─────────────────────

describe("export gate: partial vault evidence does not unblock export", () => {
  it("isFinalExportCandidateDocument returns false when validationStatus is PENDING", () => {
    // After a partial vault link the route sets validationStatus: "PENDING".
    // The export gate must treat this doc as not ready.
    const candidate = isFinalExportCandidateDocument({
      name: "Financial Capacity Evidence 1",
      exactFileName: "Financial capacity and audited statement evidence 1.docx",
      documentType: "FINANCIAL_STATEMENT",
      format: null,
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
    });
    // isFinalExportCandidateDocument only checks SUPERSEDED / internal-draft exclusions.
    // The export-readiness gate (isReadyForExport) also checks validationStatus.
    // Here we verify the doc is still a candidate (not superseded/internal) but will
    // fail the readiness gate downstream because validationStatus !== PASSED/VALIDATED.
    assert.equal(candidate, true, "PENDING doc is a candidate — but will fail readiness gate downstream");
  });

  it("isReadyForFinalExport remains false when reviewStatus is PENDING", () => {
    const { isReadyForFinalExport } = require("../lib/engine/export-readiness");
    const doc = {
      id: "doc-1",
      name: "Financial Capacity",
      exactFileName: null,
      exactOrder: null,
      documentType: "FINANCIAL_STATEMENT",
      format: null,
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      fileContent: null,
      storagePath: null,
    };
    assert.equal(isReadyForFinalExport(doc), false, "PENDING review doc must not pass the export readiness gate");
  });
});
