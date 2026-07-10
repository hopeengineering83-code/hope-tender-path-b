/**
 * Regression tests for the full production hardening (round 10).
 *
 * Tests:
 * 1. C1: Cross-tenant auth bypass — fallback restricted to ADMIN only
 * 2. H1: AI health route requires auth
 * 3. H2: HTML-escaping in deadline-alert email
 * 4. H3: Experts/projects PUT requires ADMIN/PROPOSAL_MANAGER
 * 5. O1: File delete nullifies source-evidence references
 * 6. Performance: Dashboard pagination + _count optimization
 * 7. Performance: Missing indexes added
 * 8. Performance: serverExternalPackages expanded
 * 9. Memory: setTimeout cleared in extract-text.ts race
 * 10. Dead code: drain-ai-jobs.ts deleted
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("production hardening — C1: cross-tenant auth bypass", () => {
  const src = read("app/api/tenders/[id]/proposal-versions/[versionId]/route.ts");
  const helperSrc = read("lib/tender-ownership.ts");

  it("DELETE handler delegates to requireTenderAccess (ADMIN-only fallback enforced centrally)", () => {
    // The route was refactored to use requireTenderAccess(id, actor.id, actor.role)
    // — a centralized helper that enforces ADMIN-only fallback. The literal
    // `actor.role === "ADMIN"` check now lives in lib/tender-ownership.ts (line 15),
    // not in every route handler. This is MORE secure (DRY, single audit point).
    assert.ok(
      src.includes("requireTenderAccess(id, actor.id, actor.role)"),
      "DELETE handler must delegate to requireTenderAccess with actor.role (centralized ADMIN-only fallback)",
    );
    assert.ok(
      !src.includes("?? await prisma.tender.findFirst({ where: { id } })"),
      "old unscoped ?? fallback (for all roles) must be removed",
    );
  });

  it("POST handler delegates to requireTenderAccess (ADMIN-only fallback enforced centrally)", () => {
    // Count occurrences — both DELETE and POST should delegate to requireTenderAccess.
    const delegations = (src.match(/requireTenderAccess\(id, actor\.id, actor\.role\)/g) ?? []).length;
    assert.ok(
      delegations >= 2,
      `must have at least 2 requireTenderAccess delegations (DELETE + POST), found ${delegations}`,
    );
  });

  it("requireTenderAccess helper enforces ADMIN-only fallback (the actual security property)", () => {
    // The helper IS the security gate. Verifying the literal check lives here
    // (not in every route) is the correct regression test for "C1: cross-tenant
    // auth bypass — fallback restricted to ADMIN only".
    assert.ok(
      helperSrc.includes('actorRole !== "ADMIN"'),
      "requireTenderAccess must gate the unscoped fallback on actorRole === ADMIN",
    );
    assert.ok(
      helperSrc.includes("return null; // Cross-tenant access blocked"),
      "requireTenderAccess must return null for non-ADMIN cross-tenant access",
    );
  });

  it("requireTenderAccess is the ONLY place that does the unscoped fallback (no parallel paths)", () => {
    // The route must NOT have its own prisma.tender.findFirst({ where: { id } })
    // (unscoped) — that path is now exclusively in requireTenderAccess.
    assert.ok(
      !src.includes("prisma.tender.findFirst({ where: { id },"),
      "route must not do its own unscoped tender lookup — requireTenderAccess is the only path",
    );
    assert.ok(
      helperSrc.includes('prisma.tender.findFirst({ where: { id: tenderId }'),
      "requireTenderAccess is the single place that does the ADMIN-gated unscoped lookup",
    );
  });
});

describe("production hardening — H1: AI health route auth", () => {
  const src = read("app/api/ai/health/route.ts");

  it("requires ADMIN or PROPOSAL_MANAGER role", () => {
    assert.ok(
      src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")'),
      "must call requireRole (was unauthenticated — reconnaissance gold)",
    );
  });
});

describe("production hardening — H2: HTML injection in deadline-alert email", () => {
  const src = read("app/api/cron/deadline-alerts/route.ts");

  it("HTML-escapes user-controlled values (tender title, user name)", () => {
    assert.ok(
      src.includes("const esc = (s: string)"),
      "must define an HTML-escape helper",
    );
    assert.ok(
      src.includes("esc(tender.user.name"),
      "must HTML-escape the user name",
    );
    assert.ok(
      src.includes("esc(tender.title"),
      "must HTML-escape the tender title",
    );
  });
});

describe("production hardening — H3: experts/projects PUT role check", () => {
  const expertsSrc = read("app/api/company/experts/[id]/route.ts");
  const projectsSrc = read("app/api/company/projects/[id]/route.ts");

  it("experts PUT requires ADMIN or PROPOSAL_MANAGER", () => {
    assert.ok(
      expertsSrc.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")'),
      "experts PUT must require ADMIN/PROPOSAL_MANAGER (was getSession only — VIEWER could mutate)",
    );
  });

  it("projects PUT requires ADMIN or PROPOSAL_MANAGER", () => {
    assert.ok(
      projectsSrc.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")'),
      "projects PUT must require ADMIN/PROPOSAL_MANAGER (was getSession only — VIEWER could mutate)",
    );
  });
});

describe("production hardening — O1: file delete nullifies source-evidence", () => {
  const src = read("app/api/tenders/[id]/files/[fileId]/route.ts");

  it("nullifies TenderRequirement.sourceTenderFileId on file delete", () => {
    assert.ok(
      src.includes("tenderRequirement.updateMany"),
      "must nullify TenderRequirement.sourceTenderFileId on file delete (was dangling)",
    );
  });

  it("nullifies tender source-evidence columns on file delete", () => {
    assert.ok(
      src.includes("titleSourceFileId"),
      "must nullify titleSourceFileId on file delete",
    );
    assert.ok(
      src.includes("clientNameSourceFileId"),
      "must nullify clientNameSourceFileId on file delete",
    );
    assert.ok(
      src.includes("referenceSourceFileId"),
      "must nullify referenceSourceFileId on file delete",
    );
  });

  it("uses a transaction for the nullify + delete", () => {
    assert.ok(
      src.includes("prisma.$transaction"),
      "must use a transaction for the nullify + delete (atomicity)",
    );
  });
});

describe("production hardening — performance: dashboard optimization", () => {
  const src = read("app/dashboard/page.tsx");

  it("adds pagination (take: 25) to the dashboard tender list", () => {
    assert.ok(
      src.includes("take: 25"),
      "must add take: 25 (was unbounded — loaded ALL tenders)",
    );
  });

  it("uses _count with filtered where for compliance gaps", () => {
    assert.ok(
      src.includes("complianceGaps: { where:"),
      "must use _count with filtered where (was loading full gap rows)",
    );
  });

  it("filters generatedDocuments to non-SUPERSEDED", () => {
    assert.ok(
      src.includes('generationStatus: { not: "SUPERSEDED" }'),
      "must filter generatedDocuments to non-SUPERSEDED (was loading ALL docs)",
    );
  });
});

describe("production hardening — performance: missing indexes", () => {
  const src = read("prisma/schema.prisma");

  it("adds @@index([tenderId, deletionStatus]) on TenderFile", () => {
    assert.ok(
      src.includes("@@index([tenderId, deletionStatus])"),
      "TenderFile must have compound index on (tenderId, deletionStatus) — 20+ queries filter by both",
    );
  });

  it("adds @@index([tenderId, priority]) on TenderRequirement", () => {
    assert.ok(
      src.includes("@@index([tenderId, priority])"),
      "TenderRequirement must have compound index on (tenderId, priority) — snapshot/gate filter by MANDATORY",
    );
  });
});

describe("production hardening — performance: serverExternalPackages", () => {
  const src = read("next.config.js");

  it("includes pdfjs-dist, pdf2json, @google/generative-ai, undici", () => {
    assert.ok(src.includes("pdfjs-dist"), "must include pdfjs-dist (~3MB, largest PDF lib)");
    assert.ok(src.includes("pdf2json"), "must include pdf2json");
    assert.ok(src.includes("@google/generative-ai"), "must include @google/generative-ai");
    assert.ok(src.includes("undici"), "must include undici");
  });
});

describe("production hardening — memory: setTimeout cleanup", () => {
  const src = read("lib/extract-text.ts");

  it("clears the setTimeout timer in the finally block", () => {
    assert.ok(
      src.includes("if (timer) clearTimeout(timer)"),
      "must clearTimeout in finally (was leaking the timer handle for up to 10s)",
    );
  });
});

describe("production hardening — dead code: drain-ai-jobs.ts", () => {
  it("drain-ai-jobs.ts is deleted", () => {
    assert.ok(
      !existsSync("app/api/cron/drain-ai-jobs.ts"),
      "app/api/cron/drain-ai-jobs.ts must be deleted (dead code — not a valid Next.js route)",
    );
  });
});
