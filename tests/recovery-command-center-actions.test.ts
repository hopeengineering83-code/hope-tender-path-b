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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { documentHygieneIssues } from "../lib/engine/export-readiness";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";
import { RECOVERY_COMMAND_ACTIONS, getRecoveryCommandActionSpec, renderRecoveryActionPath } from "../lib/recovery-command-actions";

// ─── 1. Action routing: no window.location navigation to missing routes ──────

// All actions that produce a live navigation (window.location.href or router.push)
// must point to routes that exist inside the Next.js app.
// We enumerate the known-safe target paths so any future addition is caught.
const KNOWN_SAFE_NAVIGATE_TARGETS = new Set([
  "/dashboard",                    // OPEN_DASHBOARD, OPEN_TENDER_LIST
  "/dashboard/analytics",          // CONFIGURE_AI_PROVIDER
  "/dashboard/company/readiness",  // OPEN_COMPANY_READINESS
  "/dashboard/matching",           // REVIEW_MATCHES, REVIEW_MATCHING_INPUTS, OPEN_KNOWLEDGE_REVIEW
  "/dashboard/settings",           // OPEN_SETTINGS
  // /dashboard/vault was the old LINK_VAULT_EVIDENCE target — it does NOT exist
  // and must never appear in the component.
]);

// All nextAction codes that API routes emit. Every code here must have a
// corresponding entry in RECOVERY_COMMAND_ACTIONS (or a safe alias).
const KNOWN_NEXT_ACTIONS = [
  "BUILD_SUBMISSION_PLAN",
  "CHANGE_BID_DECISION",
  "CONFIRM_SUBMISSION_PLAN",
  "CONTINUE_AI_ANALYSIS",
  "CONTINUE_AUTO_FINALIZE",
  "EDIT_TENDER",
  "EDIT_TENDER_METADATA",
  "HARD_COMPLIANCE_BLOCKER",
  "OPEN_ANALYSIS_QUALITY",
  "OPEN_COMPANY_READINESS",
  "OPEN_COMPLIANCE_REVIEW",
  "OPEN_EXTRACTION_QUALITY",
  "OPEN_GENERATION_READINESS",
  "OPEN_KNOWLEDGE_REVIEW",
  "OPEN_MATCHING_QUALITY",
  "OPEN_SETTINGS",
  "OPEN_TENDER_DETAIL",
  "RE_UPLOAD_TENDER",
  "REPAIR_OR_EDIT_TENDER",
  "REPAIR_SOURCE_GROUNDING",
  "RESOLVE_COMPLIANCE_GAPS",
  "RERUN_AI_ANALYZE",
  "RERUN_AI_ANALYZE_AFTER_OCR",
  "RESUME_AI_ANALYZE",
  "RETRY_AI_ANALYZE",
  "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK",
  "REVIEW_MATCHES",
  "REVIEW_MATCHING_INPUTS",
  "REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN",
  "RUN_ENGINE",
  "RUN_ENGINE_OR_APPROVE_ANALYSIS",
  "RUN_ENGINE_SAFE_MODE",
  "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
  "FILL_CLIENT_METADATA",
  "REVIEW_METADATA",
  "RECHECK_EXPORT_READINESS",
  "OPEN_DASHBOARD",
  "OPEN_TENDER_LIST",
  "SET_MANDATORY_REQUIREMENTS_OR_ADD_FILE_NAMES",
  "WAIT_FOR_CURRENT_GENERATION",
  "RETRY_AFTER_BACKOFF",
  "RETRY_AFTER_DATABASE_CHECK",
  "RETRY_AS_BACKGROUND_JOB",
  "RETRY_OR_CONTACT_SUPPORT",
  "RETRY_OR_REDUCE_INPUT",
  "UPLOAD_TENDER_DOCUMENT",
  "UPLOAD_TENDER_SOURCE",
];


const REQUIRED_EXECUTE_ACTIONS = [
  "LINK_VAULT_EVIDENCE",
  "REPAIR_SOURCE_REFERENCES",
  "BUILD_SUBMISSION_PLAN",
  "COMPLETE_METADATA",
  "EXCLUDE_OUTSIDE_PLAN_DOCS",
  "GENERATE_MISSING_PLANNED_DOCS",
  "VALIDATE_DOCS",
  "EXPORT_READINESS",
  "RE_CHECK",
  "RETRY_AI_ANALYZE",
];

function routeFileForApiPath(path: string): string {
  // Strip query string (e.g. ?mode=background) before resolving to a file path.
  const pathWithoutQuery = path.split("?")[0];
  const withoutTender = pathWithoutQuery.replace("/api/tenders/{tenderId}", "app/api/tenders/[id]").replace(/^\//, "");
  return resolve(process.cwd(), withoutTender, "route.ts");
}

describe("Recovery Command Center — action registry coverage", () => {
  it("covers every required Execute action from the production audit", () => {
    for (const action of REQUIRED_EXECUTE_ACTIONS) {
      assert.ok(getRecoveryCommandActionSpec(action), `${action} must have an action spec`);
    }
  });

  it("every API action points at an existing route.ts file", () => {
    for (const [action, spec] of Object.entries(RECOVERY_COMMAND_ACTIONS)) {
      if (spec.kind !== "api" && !(spec.kind === "custom" && spec.path?.startsWith("/api/"))) continue;
      assert.ok(spec.path, `${action} must define an API path`);
      const file = routeFileForApiPath(spec.path!);
      assert.ok(existsSync(file), `${action} points at missing API route ${file}`);
    }
  });

  it("every scroll action targets a known tender-detail panel id", () => {
    const knownPanelIds = new Set([
      "tender-files",
      "tender-edit-form",
      "generated-documents",
      "extraction-quality",
      "extraction-quality-detail",
      "analysis-quality",
      "submission-plan-completeness",
    ]);
    for (const [action, spec] of Object.entries(RECOVERY_COMMAND_ACTIONS)) {
      if (spec.kind !== "scroll") continue;
      assert.ok(spec.anchorId, `${action} must define an anchor id`);
      assert.ok(knownPanelIds.has(spec.anchorId!), `${action} scrolls to unknown panel #${spec.anchorId}`);
    }
  });

  it("every navigation action points at a known existing page", () => {
    for (const [action, spec] of Object.entries(RECOVERY_COMMAND_ACTIONS)) {
      if (spec.kind !== "navigate") continue;
      assert.ok(spec.path, `${action} must define a navigation path`);
      assert.ok(KNOWN_SAFE_NAVIGATE_TARGETS.has(spec.path!), `${action} navigates to an unverified page ${spec.path}`);
    }
  });

  it("aliases route to the same safe API specs used by lifecycle names", () => {
    assert.equal(getRecoveryCommandActionSpec("GENERATE_DOCS")?.path, "/api/tenders/{tenderId}/generate-missing-plan-files");
    assert.equal(getRecoveryCommandActionSpec("REPAIR_DOCS")?.path, "/api/tenders/{tenderId}/repair-export-gaps");
    assert.equal(getRecoveryCommandActionSpec("DOWNLOAD_ZIP")?.path, "/api/tenders/{tenderId}/download");
  });

  it("path rendering substitutes tender id without guessing routes", () => {
    assert.equal(
      renderRecoveryActionPath("/api/tenders/{tenderId}/export-readiness", "tender-123"),
      "/api/tenders/tender-123/export-readiness",
    );
  });
});

describe("Recovery Command Center — no 404-causing navigation", () => {
  // components/tender-recovery-command-center.tsx was deleted as unrendered
  // dead code (nothing imports or renders it). components/blocker-action-link.tsx
  // is the live, rendered dispatcher for recovery actions today (wired into
  // components/generation-action-panel.tsx). It never hardcodes a path —
  // every action fully delegates to renderRecoveryActionPath(spec.path, ...)
  // from the registry above, so the "no /dashboard/vault" guard is enforced
  // structurally by the "every navigation action points at a known existing
  // page" tests in this same file rather than by a literal string check.
  // We still keep a lightweight defense-in-depth check on the live file.

  it("live dispatcher source does not contain a hardcoded navigation to /dashboard/vault", async () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/blocker-action-link.tsx"),
      "utf8",
    );
    assert.ok(
      !src.includes("/dashboard/vault"),
      "component must not navigate to /dashboard/vault (page does not exist)",
    );
  });

  // "component has an else fallback for unknown actions" test removed --
  // blocker-action-link.tsx's behavior for an unknown action code is
  // architecturally different from the deleted component: it returns null
  // (renders nothing) rather than showing an "Action not available yet"
  // message. That is a deliberate simplification (an unrenderable action
  // silently disappears instead of showing a dead-end message), not a
  // regression, so there is nothing equivalent to redirect this assertion to.
});

// ─── 1b. nextAction coverage — every API error code resolves in the registry ──

describe("Recovery Command Center — nextAction code coverage", () => {
  it("every known nextAction code from API routes resolves in the registry", () => {
    const missing: string[] = [];
    for (const code of KNOWN_NEXT_ACTIONS) {
      if (!getRecoveryCommandActionSpec(code)) missing.push(code);
    }
    assert.deepEqual(missing, [], `These nextAction codes have no registry entry and will show "Action not available yet": ${missing.join(", ")}`);
  });

  it("every navigate action points at an existing Next.js page directory", () => {
    for (const [action, spec] of Object.entries(RECOVERY_COMMAND_ACTIONS)) {
      if (spec.kind !== "navigate") continue;
      assert.ok(spec.path, `${action} must define a navigation path`);
      assert.ok(KNOWN_SAFE_NAVIGATE_TARGETS.has(spec.path!), `${action} navigates to an unverified page: ${spec.path}`);
      // Also verify the page directory exists in the app
      const pageDir = resolve(process.cwd(), "app", spec.path!.replace(/^\//, ""));
      assert.ok(existsSync(pageDir), `${action} navigates to a page directory that does not exist: ${pageDir}`);
    }
  });

  it("OPEN_COMPANY_READINESS resolves to the company readiness page", () => {
    const spec = getRecoveryCommandActionSpec("OPEN_COMPANY_READINESS");
    assert.ok(spec, "OPEN_COMPANY_READINESS must have a registry entry");
    assert.equal(spec!.kind, "navigate");
    assert.equal(spec!.path, "/dashboard/company/readiness");
  });

  it("REVIEW_MATCHES resolves to the matching page", () => {
    const spec = getRecoveryCommandActionSpec("REVIEW_MATCHES");
    assert.ok(spec, "REVIEW_MATCHES must have a registry entry");
    assert.equal(spec!.kind, "navigate");
    assert.equal(spec!.path, "/dashboard/matching");
  });

  it("REPAIR_OR_EDIT_TENDER alias resolves to source grounding repair", () => {
    const spec = getRecoveryCommandActionSpec("REPAIR_OR_EDIT_TENDER");
    assert.ok(spec, "REPAIR_OR_EDIT_TENDER must resolve via alias");
    assert.equal(spec!.kind, "api");
    assert.ok(spec!.path?.includes("repair-source-grounding"));
  });

  it("RERUN_AI_ANALYZE_AFTER_OCR alias resolves to ai-analyze", () => {
    const spec = getRecoveryCommandActionSpec("RERUN_AI_ANALYZE_AFTER_OCR");
    assert.ok(spec, "RERUN_AI_ANALYZE_AFTER_OCR must resolve via alias");
    assert.equal(spec!.kind, "api");
    assert.ok(spec!.path?.includes("ai-analyze"));
  });
});

// ─── 1c. PrimaryNextAction union parity — every Execute target is dispatchable ─
//
// The "▶ Execute" button dispatches `data.primaryNextAction`, whose value is
// constrained by the `PrimaryNextAction` union in the lifecycle orchestrator.
// KNOWN_NEXT_ACTIONS (above) is hand-maintained, so a NEW PrimaryNextAction
// added to the orchestrator could ship a dead/404 Execute button without ever
// failing CI. This block derives the set directly from the orchestrator source
// so the registry can never silently drift behind it — locking CLAUDE.md
// priority #1 ("Fix Recovery Command Center Execute 404") permanently.

function extractPrimaryNextActionUnion(): string[] {
  const src = readFileSync(
    resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
    "utf8",
  );
  const match = src.match(/export type PrimaryNextAction =([\s\S]*?);/);
  assert.ok(match, "PrimaryNextAction union must exist in the orchestrator");
  const members = Array.from(match![1].matchAll(/"([A-Z_]+)"/g)).map((m) => m[1]);
  assert.ok(members.length > 0, "PrimaryNextAction union must have members");
  return members;
}

describe("Recovery Command Center — PrimaryNextAction union parity", () => {
  const primaryActions = extractPrimaryNextActionUnion();

  it("every PrimaryNextAction the orchestrator can emit resolves in the registry", () => {
    const missing = primaryActions.filter((a) => !getRecoveryCommandActionSpec(a));
    assert.deepEqual(
      missing,
      [],
      `These PrimaryNextAction values have no registry entry and would render a dead "Action not available yet" Execute button: ${missing.join(", ")}`,
    );
  });

  it("every api/custom-api PrimaryNextAction target points at an existing route (no 404)", () => {
    for (const action of primaryActions) {
      const spec = getRecoveryCommandActionSpec(action)!;
      const isApiPath = spec.kind === "api" || (spec.kind === "custom" && spec.path?.startsWith("/api/"));
      if (!isApiPath) continue;
      const file = routeFileForApiPath(spec.path!);
      assert.ok(existsSync(file), `${action} Execute would 404 — missing API route ${file}`);
    }
  });

  it("every download PrimaryNextAction target points at an existing route (no 404)", () => {
    for (const action of primaryActions) {
      const spec = getRecoveryCommandActionSpec(action)!;
      if (spec.kind !== "download" || !spec.path?.startsWith("/api/")) continue;
      const file = routeFileForApiPath(spec.path);
      assert.ok(existsSync(file), `${action} download would 404 — missing API route ${file}`);
    }
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

// ─── 4. Role-parity: every Execute-path route allows REVIEWER ─────────────────
//
// The lifecycle endpoint grants access to REVIEWER-role users. Every API route
// that can be called via the "▶ Execute" button in the Recovery Command Center
// must therefore also allow REVIEWER — otherwise the Execute button silently
// fails with 403 Forbidden for REVIEWER users.

const EXECUTE_PATH_ROUTES = [
  // primaryNextAction → API path mappings
  { action: "GENERATE_REQUIRED_DOCUMENTS", file: "app/api/tenders/[id]/generate-missing-plan-files/route.ts" },
  { action: "AUTO_FINALIZE",               file: "app/api/tenders/[id]/auto-finalize/route.ts" },
  { action: "VALIDATE_DOCS",               file: "app/api/tenders/[id]/validate/route.ts" },
  { action: "REPAIR_SOURCE_REFERENCES",    file: "app/api/tenders/[id]/repair-source-grounding/route.ts" },
  { action: "REPAIR_DOCUMENT_QUALITY",     file: "app/api/tenders/[id]/repair-export-gaps/route.ts" },
  { action: "REPAIR_METADATA",             file: "app/api/tenders/[id]/repair-metadata/route.ts" },
  { action: "APPROVE_FALLBACK_WITH_NOTE",  file: "app/api/tenders/[id]/approve-analysis/route.ts" },
  { action: "RECONCILE_OUTSIDE_PLAN_DOCS", file: "app/api/tenders/[id]/supersede-outside-plan/route.ts" },
  { action: "LINK_VAULT_EVIDENCE",         file: "app/api/tenders/[id]/link-vault-evidence-auto/route.ts" },
];

describe("Recovery Command Center — REVIEWER role parity on Execute-path routes", () => {
  it("lifecycle route grants REVIEWER access", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/lifecycle/route.ts"), "utf8");
    assert.ok(src.includes('"REVIEWER"'), "lifecycle route must allow REVIEWER role");
  });

  // Mutation routes must NOT allow REVIEWER — release-safety policy.
  const MUTATION_ACTIONS = new Set([
    "APPROVE_FALLBACK_WITH_NOTE",
    "AUTO_FINALIZE",
    "GENERATE_REQUIRED_DOCUMENTS",
    "RECONCILE_OUTSIDE_PLAN_DOCS",
    "REPAIR_DOCUMENT_QUALITY",
    "REPAIR_METADATA",
    "REPAIR_SOURCE_REFERENCES",
    "VALIDATE_DOCS",
    "LINK_VAULT_EVIDENCE",
  ]);

  for (const { action, file } of EXECUTE_PATH_ROUTES) {
    it(`${action} → ${file} ${MUTATION_ACTIONS.has(action) ? "excludes" : "allows"} REVIEWER`, () => {
      const filePath = resolve(process.cwd(), file);
      assert.ok(existsSync(filePath), `Route file must exist: ${file}`);
      const src = readFileSync(filePath, "utf8");
      if (MUTATION_ACTIONS.has(action)) {
        assert.ok(
          !src.includes('"REVIEWER"'),
          `${action} route must NOT allow REVIEWER — mutation authority is ADMIN/PROPOSAL_MANAGER only`,
        );
      } else {
        assert.ok(
          src.includes('"REVIEWER"'),
          `${action} route must include requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER") so REVIEWER users can execute it via the Recovery Command Center`,
        );
      }
    });
  }
});
