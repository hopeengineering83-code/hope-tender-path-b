// Donor #1196's activity presentation contract, reconciled against the
// RETAINED #1175 implementation. The consolidation deliberately kept
// #1175's newer Activity route/page instead of the donor snapshot
// (see the reconciliation note on PR #1175), so this file asserts the
// same safety properties — authenticated + self-scoped access, minimized
// field selection, bounded pagination, deterministic order, responsive
// mobile/desktop presentation, distinct loading/error/empty states,
// accessible controls — against the retained code's actual shape rather
// than donor-only internals (publicAuditLog, ActivityCard, MAX_* consts)
// that never existed here.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/audit/route.ts", "utf8");
const page = readFileSync("app/dashboard/activity/page.tsx", "utf8");

describe("activity API safe presentation contract", () => {

  it("authorizes API access (ADMIN-gated in the retained policy) and only returns that actor's rows", () => {
    // Retained policy is stricter than the donor's requireUser: the audit
    // feed is ADMIN-only AND still self-scoped by userId. Do not loosen
    // this without an explicit RBAC decision.
    assert.match(route, /requireRole\("ADMIN"\)/);
    assert.match(route, /userId: actor\.id/);
    assert.match(route, /NOT: \{ entityType: INTERNAL_AUDIT_ENTITY_TYPE \}/);
    assert.match(route, /prisma\.auditLog\.findMany\(\{[\s\S]*where,[\s\S]*select:/);
    assert.match(route, /prisma\.auditLog\.count\(\{ where \}\)/);
  });

  it("selects only minimized public audit-log fields", () => {
    assert.match(route, /select: \{\s*id: true,\s*action: true,\s*entityType: true,\s*description: true,\s*createdAt: true,\s*\}/);
    assert.doesNotMatch(route, /metadata: true/);
    assert.doesNotMatch(route, /entityId: true/);
  });

  it("never forwards raw metadata or entity ids to the client", () => {
    // The retained route minimizes at the SELECT (no metadata/entityId
    // ever leave the database layer) and groups duplicates before
    // responding — there is no donor-style publicAuditLog mapper to
    // assert, because nothing non-minimized reaches the response.
    assert.match(route, /groupAuditLogs\(rawLogs\)/);
    assert.doesNotMatch(page, /metadata:/);
    assert.doesNotMatch(page, /entityId:/);
  });

  it("bounds page sizes and recovers from invalid page or limit values", () => {
    assert.match(route, /function positiveInteger/);
    assert.match(route, /Number\.isFinite\(parsed\) && parsed > 0 \? parsed : fallback/);
    assert.match(route, /Math\.min\(50, positiveInteger\(searchParams\.get\("limit"\), 30\)\)/);
    assert.match(route, /positiveInteger\(searchParams\.get\("page"\), 1\)/);
  });

  it("rejects unknown filters and uses deterministic pagination order", () => {
    assert.match(route, /isSafeAuditAction\(requestedAction\)/);
    assert.match(route, /Unsupported activity filter/);
    assert.match(route, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  });

  it("renders activity as mobile cards plus a desktop table without relying on global clipping", () => {
    assert.match(page, /className="divide-y md:hidden"/);
    assert.match(page, /className="hidden min-w-0 md:block"/);
    assert.doesNotMatch(page, /overflow-x-hidden/);
  });

  it("distinguishes loading, error, empty, and success states with accessible semantics", () => {
    assert.match(page, /role="status"/);
    assert.match(page, /role="alert"/);
    assert.match(page, /No activity recorded yet\./);
    assert.match(page, /aria-label="Retry activity logs"/);
    assert.match(page, /if \(!response\.ok\) throw new Error/);
  });

  it("uses accessible filter and pagination controls", () => {
    assert.match(page, /aria-label="Activity filters"/);
    assert.match(page, /aria-pressed=\{filter === action\}/);
    assert.match(page, /aria-label="Activity pagination"/);
    assert.match(page, /aria-label="Previous activity page"/);
    assert.match(page, /aria-label="Next activity page"/);
  });
});
