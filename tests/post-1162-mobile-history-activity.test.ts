import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const history = readFileSync("app/dashboard/history/page.tsx", "utf8");

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

  it("covers canonical states that the previous local filter list omitted", () => {
    assert.match(history, /const STATUSES = \["ALL", \.\.\.TENDER_STATUSES\]/);
    assert.doesNotMatch(history, /"FALLBACK_DRAFT_CREATED","ANALYSIS_REQUIRES_REVIEW","MATCHED"/);
  });
});
