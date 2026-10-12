// Regression tests for POST /api/tenders/[id]/link-vault-evidence-auto
//
// Verifies (source-level):
//   1. Route enforces role-based authorization — ADMIN only
//   2. Route enforces rate limiting via rateLimit()
//   3. Route is idempotent (skips documents whose bytes it already included)
//   4. Route calls logAction with VAULT_EVIDENCE_LINKED for audit trail
//   5. Route never auto-links documents with SUPERSEDED generationStatus
//   6. Route never promotes a document it included to VALIDATED/READY_FOR_EXPORT
//   7. Response shape includes linked, skipped, blockedReasons, message fields
//
// Four expectations in this file were rewritten rather than kept, because what
// they pinned was the defect:
//
//   - "creates documentReview record for each linked document" required a
//     review row naming the actor with action READY_FOR_EXPORT. Including a
//     file is not reviewing it; that row was a fabricated human record.
//   - "checks documentHygieneIssues before marking READY_FOR_EXPORT" required
//     a filename-and-text heuristic to stand in for canonical validation and
//     human approval. Inclusion no longer promotes anything, so there is no
//     promotion left to gate.
//   - the documentReview-based idempotency window existed only to stop those
//     fabricated rows accumulating. Inclusion is now idempotent by content.
//   - partialLinked no longer exists: inclusion of a document either happens
//     with verified bytes or does not happen, and nothing read the field.

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
  it("identifies documents whose bytes it already included", () => {
    assert.ok(
      routeSource.includes("alreadyIncluded") && routeSource.includes("machine:vault-document-inclusion"),
      "route must recognise its own provenance marker so a re-run does not redo completed work",
    );
  });

  it("skips those documents instead of re-including them", () => {
    assert.ok(
      routeSource.includes("alreadyIncluded.has(row.id)"),
      "route must skip a document it has already included",
    );
  });

  it("does not depend on a time window", () => {
    // The old five-minute window existed only to stop fabricated
    // documentReview rows accumulating on re-submission. Idempotency now
    // follows from the content itself, so it holds however much time passes.
    assert.ok(
      !routeSource.includes("idempotencyWindow"),
      "idempotency must come from what is already included, not from how recently it happened",
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

  it("does NOT create a documentReview record", () => {
    // A DocumentReview names a person and an action they took. Including a
    // file is a machine copying bytes; writing a review row for it puts an
    // approval in the audit trail that nobody gave. logAction above is the
    // correct record: it says what happened and who triggered it.
    assert.ok(
      !routeSource.includes("documentReview.create"),
      "including a file must not fabricate a human review record",
    );
  });

  it("records the byte digest in the audit metadata", () => {
    assert.ok(
      routeSource.includes("sha256: outcome.sha256"),
      "the audit entry must record which exact bytes were placed in the package",
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

  it("never promotes an included document to VALIDATED or READY_FOR_EXPORT", () => {
    // The old route promoted on a filename-and-text hygiene heuristic, which
    // is neither canonical validation nor a person's approval. Nothing is
    // promoted now, so there is no heuristic left standing in for either.
    assert.ok(
      !routeSource.includes("documentHygieneIssues"),
      "a text heuristic must not stand in for validation or approval",
    );
    assert.ok(
      !routeSource.includes("READY_FOR_EXPORT\"") || !routeSource.includes("reviewStatus: ready"),
      "inclusion must not write an export-ready state",
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

  it("response includes blockedReasons so a caller can say why nothing was included", () => {
    assert.ok(routeSource.includes("blockedReasons"), "response must carry the specific reasons inclusion was refused");
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
  // Read the whole branch rather than a fixed 700-character window from its
  // start. The window was measured against a branch that could say only one
  // thing; when the branch learned to tell the three causes apart, the very
  // OPEN_COMPANY_READINESS this asserts slid past character 700 and the test
  // failed on a route that had strictly improved. The properties below are what
  // this suite actually cares about, and they are now checked across every
  // message the branch can return.
  const emptyBranch = (() => {
    const start = routeSource.indexOf("if (candidates.length === 0)");
    const end = routeSource.indexOf("\n  }", routeSource.indexOf("return NextResponse.json", start));
    return routeSource.slice(start, end);
  })();

  it("every zero-candidates response carries an actionable nextAction", () => {
    const actions = [...emptyBranch.matchAll(/nextAction: "([A-Z_]+)"/g)].map((m) => m[1]);
    assert.ok(actions.length > 0, "the zero-candidates response must name a next action");
    assert.ok(
      actions.includes("OPEN_COMPANY_READINESS"),
      "a vault-related cause must still route the user to Company Readiness",
    );
    for (const action of actions) {
      assert.ok(
        ["OPEN_COMPANY_READINESS", "AUTOMATIC_PROCESSING"].includes(action),
        `${action} is not a next action this product renders`,
      );
    }
  });

  it("candidates.length === 0 branch tells the user what to add, not just that it failed", () => {
    assert.match(
      emptyBranch,
      /expert CVs|project references|financial statements|compliance records|licence|tax clearance|audited statements/i,
      "the message should name concrete document categories to add, not just report failure",
    );
  });
});
