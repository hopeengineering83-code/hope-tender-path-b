// Regression tests for POST /api/tenders/[id]/link-vault-evidence-auto
//
// Verifies (source-level):
//   1. Route enforces role-based authorization (ADMIN, PROPOSAL_MANAGER, REVIEWER)
//   2. Route enforces rate limiting via rateLimit()
//   3. Route includes idempotency protection (skips recently-linked documents)
//   4. Route creates documentReview records (one per linked document)
//   5. Route calls logAction with VAULT_EVIDENCE_LINKED for audit trail
//   6. Route never auto-links documents with SUPERSEDED generationStatus
//   7. Route checks documentHygieneIssues before marking READY_FOR_EXPORT
//   8. Response shape includes linked, partialLinked, skipped, message fields

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const routeSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/link-vault-evidence-auto/route.ts"),
  "utf-8",
);

describe("link-vault-evidence-auto — authorization", () => {
  it("enforces requireRole check", () => {
    assert.ok(
      routeSource.includes('requireRole("ADMIN"'),
      "route must call requireRole to reject unauthorized callers",
    );
  });

  it("excludes REVIEWER from mutation roles", () => {
    assert.ok(
      !routeSource.includes('"REVIEWER"'),
      "REVIEWER role must NOT be allowed for mutation routes",
    );
  });

  it("returns 401 for unauthenticated requests", () => {
    assert.ok(
      routeSource.includes("unauthorizedResponse"),
      "route must call unauthorizedResponse() when no session exists",
    );
  });

  it("returns 403 for insufficiently-privileged sessions", () => {
    assert.ok(
      routeSource.includes("forbiddenResponse"),
      "route must call forbiddenResponse() for authenticated but unauthorized callers",
    );
  });
});

describe("link-vault-evidence-auto — rate limiting", () => {
  it("applies MUTATION_RATE_LIMIT", () => {
    assert.ok(
      routeSource.includes("MUTATION_RATE_LIMIT"),
      "route must use MUTATION_RATE_LIMIT to prevent abuse",
    );
  });

  it("returns 429 with Retry-After header when rate limit exceeded", () => {
    assert.ok(
      routeSource.includes("status: 429") && routeSource.includes("Retry-After"),
      "route must return 429 with Retry-After when rate limited",
    );
  });
});

describe("link-vault-evidence-auto — idempotency", () => {
  it("queries for recently-linked documentReview records before processing", () => {
    assert.ok(
      routeSource.includes("alreadyLinkedIds") && routeSource.includes("Auto-linked vault evidence"),
      "route must check for existing auto-link reviews within a recent window to prevent duplicate documentReview records",
    );
  });

  it("skips documents already linked within the idempotency window", () => {
    assert.ok(
      routeSource.includes("alreadyLinkedIds.has(row.id)"),
      "route must skip documents that already have a recent auto-link review",
    );
  });

  it("uses a time-bounded idempotency window (not indefinite)", () => {
    assert.ok(
      routeSource.includes("idempotencyWindow") && routeSource.includes("Date.now()"),
      "idempotency check must be time-bounded so re-running after the window still links",
    );
  });
});

describe("link-vault-evidence-auto — audit logging", () => {
  it("calls logAction for each linked document", () => {
    assert.ok(
      routeSource.includes("logAction"),
      "route must call logAction to produce an audit trail for each vault evidence link",
    );
  });

  it("uses VAULT_EVIDENCE_LINKED action code", () => {
    assert.ok(
      routeSource.includes('"VAULT_EVIDENCE_LINKED"'),
      "audit action must be VAULT_EVIDENCE_LINKED so audit log queries can filter it",
    );
  });

  it("creates documentReview record for each linked document", () => {
    assert.ok(
      routeSource.includes("documentReview.create"),
      "route must create a documentReview record per linked document for audit/history",
    );
  });
});

describe("link-vault-evidence-auto — export safety", () => {
  it("never processes SUPERSEDED documents", () => {
    assert.ok(
      routeSource.includes('"SUPERSEDED"'),
      'generatedDocuments query must filter out SUPERSEDED documents (generationStatus: { not: "SUPERSEDED" })',
    );
  });

  it("checks documentHygieneIssues before marking READY_FOR_EXPORT", () => {
    assert.ok(
      routeSource.includes("documentHygieneIssues"),
      "route must check hygiene issues; documents with issues must not be auto-promoted to READY_FOR_EXPORT",
    );
  });

  it("only processes documents with eligible reviewStatus values", () => {
    assert.ok(
      routeSource.includes("REPLACE_WITH_ORIGINAL") && routeSource.includes("CHANGES_REQUESTED"),
      "route must limit candidate documents to known eligible reviewStatus values",
    );
  });
});

describe("link-vault-evidence-auto — response shape", () => {
  it("response includes linked count", () => {
    assert.ok(routeSource.includes("linked,"), "response must include linked count");
  });

  it("response includes partialLinked count", () => {
    assert.ok(routeSource.includes("partialLinked,"), "response must include partialLinked count");
  });

  it("response includes skipped count", () => {
    assert.ok(routeSource.includes("skipped,"), "response must include skipped count");
  });

  it("response includes message string", () => {
    assert.ok(routeSource.includes("message"), "response must include a human-readable message");
  });
});

describe("link-vault-evidence-auto — company-not-found is 422 not 404", () => {
  it("splits company-not-found from tender-not-found", () => {
    assert.ok(
      !routeSource.includes("Tender or company not found"),
      "route must NOT use the old combined 'Tender or company not found' 404 message — company absence is 422",
    );
  });

  it("returns 404 only when tender is missing", () => {
    assert.ok(
      routeSource.includes('"Tender not found"') && routeSource.includes("status: 404"),
      "route must return 404 specifically when the tender is not found",
    );
  });

  it("returns 422 with COMPANY_NOT_FOUND code when company is missing", () => {
    assert.ok(
      routeSource.includes("COMPANY_NOT_FOUND") && routeSource.includes("status: 422"),
      "route must return 422 with COMPANY_NOT_FOUND code when the user has no company profile",
    );
  });

  it("422 response includes nextAction to direct user to company setup", () => {
    assert.ok(
      routeSource.includes("OPEN_COMPANY_READINESS"),
      "422 company-not-found response must include nextAction: OPEN_COMPANY_READINESS so the Recovery Command Center can surface the action",
    );
  });
});

describe("link-vault-evidence-auto — empty-vault response gives an actionable next step", () => {
  // Previously, when the Knowledge Vault had zero documents matching any
  // required category, the route returned a dead-end message with no
  // nextAction — the Recovery Command Center's "Link Vault Evidence → Execute"
  // button would report failure with no guidance on what to actually do.
  // This mirrors the company-not-found (422) response, which already carried
  // nextAction: OPEN_COMPANY_READINESS.
  it("candidates.length === 0 branch includes nextAction: OPEN_COMPANY_READINESS", () => {
    const emptyBranch = routeSource.slice(
      routeSource.indexOf("if (candidates.length === 0)"),
      routeSource.indexOf("if (candidates.length === 0)") + 400,
    );
    assert.ok(
      emptyBranch.includes("OPEN_COMPANY_READINESS"),
      "the zero-candidates response must include nextAction: OPEN_COMPANY_READINESS so the caller can guide the user to populate the vault",
    );
  });

  it("candidates.length === 0 branch tells the user what to add, not just that it failed", () => {
    const emptyBranch = routeSource.slice(
      routeSource.indexOf("if (candidates.length === 0)"),
      routeSource.indexOf("if (candidates.length === 0)") + 400,
    );
    assert.match(
      emptyBranch,
      /expert CVs|project references|financial statements|compliance records/i,
      "the message should name concrete document categories to add, not just report failure",
    );
  });
});
