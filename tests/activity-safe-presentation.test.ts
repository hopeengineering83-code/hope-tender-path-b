import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/audit/route.ts", "utf8");
const page = readFileSync("app/dashboard/activity/page.tsx", "utf8");

describe("activity API safe presentation contract", () => {
  it("selects only minimized public audit-log fields", () => {
    assert.match(route, /select: \{ id: true, action: true, entityType: true, description: true, createdAt: true \}/);
    assert.doesNotMatch(route, /metadata: true/);
    assert.doesNotMatch(route, /entityId: true/);
  });

  it("returns presentation DTOs with opaque display ids and no raw metadata/entity ids", () => {
    assert.match(route, /function publicAuditLog/);
    assert.match(route, /id: `audit_\$\{row\.id\.slice\(0, 8\)\}`/);
    assert.match(route, /logs: logs\.map\(publicAuditLog\)/);
    assert.doesNotMatch(page, /metadata:/);
    assert.doesNotMatch(page, /entityId:/);
  });

  it("bounds page sizes and recovers from invalid page or limit values", () => {
    assert.match(route, /const MAX_PAGE_SIZE = 50/);
    assert.match(route, /const DEFAULT_PAGE_SIZE = 30/);
    assert.match(route, /function parsePositiveInt/);
    assert.match(route, /Number\.isFinite\(parsed\) && parsed > 0/);
    assert.match(route, /Math\.min\(MAX_PAGE_SIZE, requestedLimit\)/);
  });

  it("bounds public text and uses deterministic pagination order", () => {
    assert.match(route, /const MAX_TEXT_LENGTH = 240/);
    assert.match(route, /function boundText/);
    assert.match(route, /normalized\.slice\(0, MAX_TEXT_LENGTH - 1\)/);
    assert.match(route, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  });

  it("renders activity as mobile cards plus a desktop table without relying on global clipping", () => {
    assert.match(page, /<ActivityCard key=\{log\.id\} log=\{log\} \/>/);
    assert.match(page, /className="space-y-3 p-3 md:hidden"/);
    assert.match(page, /className="hidden overflow-x-auto md:block"/);
    assert.doesNotMatch(page, /overflow-x-hidden/);
  });

  it("distinguishes loading, error, empty, and success states with accessible semantics", () => {
    assert.match(page, /role="status"/);
    assert.match(page, /role="alert"/);
    assert.match(page, /No activity recorded yet\./);
    assert.match(page, /Retry activity logs/);
    assert.match(page, /if \(!res\.ok\)/);
  });

  it("uses accessible filter and pagination controls", () => {
    assert.match(page, /aria-label="Activity filters"/);
    assert.match(page, /aria-pressed=\{filter === a\}/);
    assert.match(page, /aria-label="Activity pagination"/);
    assert.match(page, /aria-current="page"/);
    assert.match(page, /aria-label="Previous activity page"/);
    assert.match(page, /aria-label="Next activity page"/);
  });
});
