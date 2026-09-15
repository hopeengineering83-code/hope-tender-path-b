import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { groupAuditLogs, presentAuditLog } from "../lib/audit-log-presentation";

describe("activity-log privacy presentation", () => {
  it("never returns raw descriptions, identifiers, filenames, paths, or contact details", () => {
    const rawDescription = [
      "admin@hope.local",
      "job 45a2d090-af4c-4815-9736-c8b5bbbdf89d",
      "/storage/uploads/private/tender.pdf",
      "+251 911 000 000",
      "repair internals",
    ].join(" ");
    const presented = presentAuditLog({
      id: "internal-log-id",
      action: "TENDER_UPDATE",
      entityType: "Tender",
      description: rawDescription,
      createdAt: "2026-07-15T19:00:00.000Z",
    });

    assert.equal(presented.description, "Tender record updated.");
    assert.notEqual(presented.id, "internal-log-id");
    assert.doesNotMatch(JSON.stringify(presented), /hope\.local|45a2d090|tender\.pdf|storage\/uploads|251 911|repair internals/i);
  });

  it("maps unknown internal events to a minimal generic description", () => {
    const presented = presentAuditLog({
      id: "log-2",
      action: "PRIVATE_INTERNAL_REPAIR_STEP",
      entityType: "UnknownInternalEntity",
      description: "private filename.docx and user@example.com",
      createdAt: "2026-07-15T19:00:00.000Z",
    });
    assert.equal(presented.description, "Audit event recorded.");
    assert.equal(presented.action, "AUDIT_EVENT");
    assert.notEqual(presented.action, "INTERNAL_REPAIR_WORKER_RETRY");
    assert.equal(presented.entityType, null);
    assert.doesNotMatch(JSON.stringify(presented), /filename|example\.com|UnknownInternalEntity/);
  });

  it("groups duplicate events within the bounded time window even when interleaved", () => {
    const grouped = groupAuditLogs([
      { id: "1", action: "AI_ANALYZE", entityType: "Tender", description: "raw one", createdAt: "2026-07-15T19:05:00.000Z" },
      { id: "2", action: "TENDER_UPDATE", entityType: "Tender", description: "raw two", createdAt: "2026-07-15T19:03:00.000Z" },
      { id: "3", action: "AI_ANALYZE", entityType: "Tender", description: "raw three", createdAt: "2026-07-15T19:00:00.000Z" },
    ]);

    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].count, 2);
    assert.equal(grouped[0].description, "AI analysis queued.");
    assert.equal(grouped[1].count, 1);
  });
});

describe("activity route and responsive UI contracts", () => {
  const routeSource = readFileSync("app/api/audit/route.ts", "utf8");
  const pageSource = readFileSync("app/dashboard/activity/page.tsx", "utf8");

  it("tenant-scopes the query and excludes raw metadata and entity identifiers", () => {
    assert.match(routeSource, /userId:\s*actor\.id/);
    assert.doesNotMatch(routeSource, /select:\s*\{[^}]*entityId/s);
    assert.doesNotMatch(routeSource, /select:\s*\{[^}]*metadata/s);
    assert.match(routeSource, /groupAuditLogs\(rawLogs\)/);
  });

  it("uses responsive cards at 390px and a bounded table only from md upward", () => {
    assert.match(pageSource, /className="divide-y md:hidden"/);
    assert.match(pageSource, /className="hidden [^"]*md:block"/);
    assert.match(pageSource, /table-fixed/);
    assert.match(pageSource, /truncate px-4 py-3 text-slate-700/);
    assert.doesNotMatch(pageSource, /max-w-xs truncate/);
  });
});
