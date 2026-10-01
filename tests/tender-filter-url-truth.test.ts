import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  TENDER_STATUSES,
  TENDER_STATUS_LABELS,
  parseTenderStatus,
} from "../lib/tender-workflow";

const filterSource = readFileSync("components/tender-search-bar.tsx", "utf8");

describe("tender list filter URL truth", () => {
  it("renders the status selector from the canonical workflow registry", () => {
    assert.match(filterSource, /TENDER_STATUSES\.map/);
    assert.match(filterSource, /TENDER_STATUS_LABELS\[value\]/);
    assert.doesNotMatch(filterSource, /<option value="INTAKE">/);
  });

  it("represents every canonical status, including intake and analysis states", () => {
    const requiredStatuses = [
      "INTAKE",
      "ANALYZED",
      "AI_ANALYZED",
      "AI_ANALYSIS_PARTIAL",
      "FALLBACK_DRAFT_CREATED",
      "ANALYSIS_REQUIRES_REVIEW",
      "MATCHED",
      "COMPLIANCE_REVIEW",
      "READY_FOR_GENERATION",
      "NO_BID",
    ] as const;

    for (const status of requiredStatuses) {
      assert.ok(TENDER_STATUSES.includes(status));
      assert.ok(TENDER_STATUS_LABELS[status].length > 0);
      assert.equal(parseTenderStatus(status), status);
    }
  });

  it("normalizes a URL status before binding the select value", () => {
    assert.match(filterSource, /rawStatus === "REGEX_FALLBACK"/);
    assert.match(filterSource, /parseTenderStatus\(rawStatus\)/);
    assert.match(filterSource, /value=\{status\}/);
  });

  it("clears q and status in one URL navigation", () => {
    const clearBlock = filterSource.match(/function clearFilters\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    assert.match(clearBlock, /params\.delete\("q"\)/);
    assert.match(clearBlock, /params\.delete\("status"\)/);
    assert.equal((clearBlock.match(/navigate\(params\)/g) ?? []).length, 1);
  });

  it("keeps browser navigation authoritative for the search input", () => {
    assert.match(filterSource, /setQ\(currentQuery\)/);
    assert.match(filterSource, /\[currentQuery\]/);
  });
});
