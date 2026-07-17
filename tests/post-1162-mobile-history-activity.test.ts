import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const history = readFileSync("app/dashboard/history/page.tsx", "utf8");
const activity = readFileSync("app/dashboard/activity/page.tsx", "utf8");

describe("post-1162 tender history mobile truth", () => {
  it("uses canonical tender statuses and human-readable labels", () => {
    assert.match(history, /TENDER_STATUSES/);
    assert.match(history, /formatTenderStatus/);
    assert.match(history, /All statuses/);
    assert.doesNotMatch(history, /const STATUSES = \["ALL","DRAFT"/);
  });

  it("uses a compact mobile status selector and keeps desktop filter chips", () => {
    assert.match(history, /Filter by status/);
    assert.match(history, /className="flex items-end gap-2 rounded-xl border bg-white p-3 md:hidden"/);
    assert.match(history, /aria-label="Tender status filters"/);
    assert.match(history, /className="hidden flex-wrap gap-2 text-xs md:flex"/);
  });

  it("uses readable mobile cards and a desktop-only table", () => {
    assert.match(history, /className="divide-y md:hidden"/);
    assert.match(history, /<article key=\{tender\.id\}/);
    assert.match(history, /className="hidden w-full text-sm md:table"/);
    assert.match(history, /Generated docs/);
  });

  it("preserves the active status when searching or clearing text", () => {
    assert.match(history, /type="hidden" name="status" value=\{activeStatus\}/);
    assert.match(history, /encodeURIComponent\(activeStatus\)/);
  });
});

describe("post-1162 activity log mobile truth", () => {
  it("uses human-readable action labels instead of raw audit codes", () => {
    assert.match(activity, /const ACTION_LABELS/);
    assert.match(activity, /Tender file uploaded/);
    assert.match(activity, /Export package downloaded/);
    assert.match(activity, /formatAction\(log\.action\)/);
    assert.doesNotMatch(activity, /\{log\.action\.replace\(\/_\/g, " "\)\}/);
  });

  it("uses a compact mobile filter and accessible desktop pressed states", () => {
    assert.match(activity, /Filter by activity/);
    assert.match(activity, /className="block text-sm font-medium text-slate-700 md:hidden"/);
    assert.match(activity, /role="group" aria-label="Activity filters"/);
    assert.match(activity, /aria-pressed=\{filter === action\}/);
  });

  it("uses mobile cards, desktop table, and visible load failure recovery", () => {
    assert.match(activity, /className="divide-y md:hidden"/);
    assert.match(activity, /<article key=\{log\.id\}/);
    assert.match(activity, /className="hidden w-full table-fixed text-sm md:table"/);
    assert.match(activity, /role="alert"/);
    assert.match(activity, />Retry</);
  });

  it("uses readable pagination controls instead of raw glyph-only buttons", () => {
    assert.match(activity, />Previous</);
    assert.match(activity, />Next</);
    assert.match(activity, /Page \{page\} of \{totalPages\}/);
    assert.doesNotMatch(activity, />‹</);
    assert.doesNotMatch(activity, />›</);
  });
});
