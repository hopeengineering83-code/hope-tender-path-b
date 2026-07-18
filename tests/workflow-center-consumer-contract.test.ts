// Locks the /api/tenders/[id]/workflow-center response contract against
// every client component that consumes it.
//
// Three panels on the tender detail page were silently dead because they
// read top-level keys the consolidated route has never returned:
//   - SubmissionPlanTruthPanel read `json.plan` -> never rendered, and
//     NextActionPanel's "#submission-plan" scroll anchor never existed.
//   - AuthorityReviewTruthPanel read `json.authority` -> never rendered.
//   - RequirementTruthBanner read `json.analysis.state` -> threw
//     (undefined.state) on every tender detail load, logging a phantom
//     "fetch failed" error, and could never fire its warning.
//
// The generic scan below fails if ANY component fetching workflow-center
// reads a top-level `json.<key>` outside the route's actual response keys,
// so this class of silent contract drift cannot recur unnoticed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = "app/api/tenders/[id]/workflow-center/route.ts";
const route = readFileSync(ROUTE_PATH, "utf8");

// The route's single success response shape.
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "ok", "snapshot", "workflow", "decision", "stages", "classification", "pageLedgers",
  // error responses
  "error",
]);

describe("workflow-center consumer contract", () => {
  it("the route still returns the expected top-level keys", () => {
    for (const key of ["ok: true", "snapshot,", "workflow,", "stages,", "classification: classificationSummary", "pageLedgers: pageLedgerSummary"]) {
      assert.ok(route.includes(key), `route response must include ${key}`);
    }
  });

  it("no component reads a top-level workflow-center key the route does not return", () => {
    const componentsDir = "components";
    const offenders: string[] = [];
    for (const file of readdirSync(componentsDir)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      // Strip line comments so historical notes about the old (broken)
      // contract don't count as reads, then only scan files that actually
      // FETCH workflow-center in live code.
      const src = readFileSync(join(componentsDir, file), "utf8")
        .split("\n")
        .map((line) => line.replace(/^\s*\/\/.*$/, ""))
        .join("\n");
      if (!/fetch\([^)]*workflow-center/.test(src)) continue;
      // Direct top-level reads in the fetch handler: json.<key>
      for (const match of src.matchAll(/\bjson\??\.([a-zA-Z]+)/g)) {
        const key = match[1];
        if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
          offenders.push(`${file}: json.${key}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `components read top-level workflow-center keys the route never returns: ${offenders.join(", ")}`,
    );
  });

  it("SubmissionPlanTruthPanel consumes the dedicated submission-plan route's summary", () => {
    const src = readFileSync("components/submission-plan-truth-panel.tsx", "utf8");
    assert.match(src, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/submission-plan`\)/);
    assert.match(src, /json\.summary/);
    assert.match(src, /planState/);
    assert.match(src, /requiresUserConfirmation/);
    // Anchor stability: id="submission-plan" must be attached in every
    // branch (it is a NextActionPanel scroll target).
    const branchCount = (src.match(/id="submission-plan"/g) ?? []).length;
    assert.ok(branchCount >= 3, `id="submission-plan" must exist in loading, error, and loaded branches (found ${branchCount})`);
  });

  it("AuthorityReviewTruthPanel consumes the dedicated authority-review route", () => {
    const src = readFileSync("components/authority-review-truth-panel.tsx", "utf8");
    assert.match(src, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/authority-review`/);
    assert.match(src, /authorityReview/);
    assert.match(src, /primaryBlockerReason/);
  });

  it("RequirementTruthBanner reads the canonical analysis state from snapshot.analysis.state", () => {
    const src = readFileSync("components/requirement-truth-banner.tsx", "utf8");
    assert.match(src, /setStatus\(json\.snapshot\?\.analysis\?\.state \?\? null\)/);
    assert.doesNotMatch(src, /setStatus\(json\.analysis\.state\)/);
    assert.match(src, /SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED/);
  });
});
