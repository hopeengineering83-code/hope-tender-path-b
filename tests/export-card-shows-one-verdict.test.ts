/**
 * One readiness verdict leads the card.
 *
 * Captured on the Export Hub while proving the BLOCKED direction, on a package
 * whose download correctly answered 409:
 *
 *   "… Rural Water Supply Schemes  [Exported]  [Not ready]
 *      3 / 3 docs generated   ZIP locked   1 blocker — view checklist to resolve"
 *
 * The green "Exported" pill sat beside the amber "Not ready" pill. Both facts
 * were true — a ZIP was downloaded earlier, and the package is not ready now —
 * but rendered as two status pills in competing colours they read as a
 * contradiction, on exactly the surface this release spent its effort making
 * unambiguous.
 *
 * The state is ordinary, not contrived: download a package, then regenerate or
 * invalidate one of its documents.
 *
 * The fact is not removed. "Exported" keeps its green only while the package
 * IS ready; when it is not, it says "Exported earlier" in a neutral colour, so
 * the current verdict leads and the history is still visible. The download
 * link and the blocker text are untouched — those already tracked the
 * canonical verdict correctly, which is why the BLOCKED capture's 409 and the
 * UI agreed.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync("app/dashboard/export/export-tender-card.tsx", "utf8");

/** The badge block, without its explanatory comment. */
const BADGES = (() => {
  const start = SOURCE.indexOf("{isExported &&");
  const end = SOURCE.indexOf("</div>", start);
  return SOURCE.slice(start, end).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
})();

describe("export card readiness badges", () => {
  it("never shows the green Exported pill on a package that is not ready", () => {
    assert.match(
      BADGES,
      /\{isExported && isReady &&[^}]*bg-green-100/,
      "the green Exported pill must be conditioned on the package being ready",
    );
    assert.doesNotMatch(
      BADGES,
      /\{isExported &&\s*<span[^>]*bg-green-100/,
      'an unconditional green Exported pill can sit beside "Not ready"',
    );
  });

  it("still says the package was exported earlier", () => {
    // The fact matters — the owner may already have submitted that ZIP.
    assert.match(BADGES, /\{isExported && !isReady &&[^}]*Exported earlier/);
    assert.match(
      BADGES,
      /\{isExported && !isReady &&[^}]*bg-slate-100/,
      "and says it outside the readiness colours",
    );
  });

  it("keeps exactly one readiness verdict", () => {
    // Ready and Not ready remain mutually exclusive and exhaustive.
    assert.match(BADGES, /\{isReady && !isExported &&[^}]*>Ready</);
    assert.match(BADGES, /\{!isReady &&[^}]*>Not ready</);
  });

  it("leaves the download control keyed to the canonical verdict", () => {
    // Untouched by this change: the ZIP link and the lock already followed
    // readiness plus the canonical blocker list.
    assert.match(SOURCE, /\{isReady && canonicalBlockerCodes\.length === 0 && \(/);
    assert.match(SOURCE, /\{!isReady && canonicalBlockerCodes\.length > 0 && \(/);
    assert.match(SOURCE, /ZIP locked/);
  });
});
