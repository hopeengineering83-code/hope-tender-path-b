// ─── A passed deadline is counted on a calendar, not on a stopwatch ─────────
//
// THE DEFECT. The DEADLINE_PASSED advisory counted elapsed DURATION and
// printed it beside a calendar DATE:
//
//   const daysAgo = Math.round((now.getTime() - effDeadline.getTime()) / DAY);
//   `Submission deadline passed ${daysAgo} days ago (${date})`
//
// Read on the exact-head Preview at 2026-09-22T14:35Z against a deadline of
// 2026-08-25, that produced, verbatim:
//
//   (warning) DEADLINE_PASSED: Submission deadline passed 29 days ago
//   (2026-08-25). Late submissions are typically rejected by evaluators.
//
// 2026-08-25 to 2026-09-22 is 28 days. The sentence contradicts the date
// inside it, and an owner can do the subtraction. Rounding also lets the
// count contradict the fact being reported: a deadline that passed at 23:00
// and is read at 01:00 is 0.08 days old, which rounds to "passed 0 days ago".
//
// WHAT IS NOT CHANGED. The gate. DEADLINE_PASSED still fires on
// `effDeadline < now` and is still a HIGH ADVISORY, never a hard blocker --
// a historical benchmark deadline must keep producing this warning.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeDeadlinePassed } from "../lib/engine/export-readiness";

describe("a passed deadline is counted on a calendar", () => {
  it("reports the observed case as the calendar says, not as rounding said", () => {
    // The exact reading above: 29 was wrong, 28 is the number of calendar days.
    assert.equal(
      describeDeadlinePassed(new Date("2026-08-25T00:00:00Z"), new Date("2026-09-22T14:35:00Z")),
      "28 days ago",
    );
  });

  it("does not say a passed deadline passed zero days ago", () => {
    const phrase = describeDeadlinePassed(
      new Date("2026-09-21T23:00:00Z"),
      new Date("2026-09-22T01:00:00Z"),
    );
    assert.equal(phrase, "1 day ago");
    assert.equal(/\b0 days?\b/.test(phrase), false);
  });

  it("says so plainly when the deadline passed earlier the same day", () => {
    assert.equal(
      describeDeadlinePassed(new Date("2026-09-22T08:00:00Z"), new Date("2026-09-22T23:30:00Z")),
      "earlier today",
    );
  });

  it("agrees with the date the same sentence prints, at any time of day", () => {
    const deadline = new Date("2026-08-25T16:45:00Z");
    for (const hour of [0, 6, 12, 18, 23]) {
      const now = new Date(`2026-09-22T${String(hour).padStart(2, "0")}:00:00Z`);
      assert.equal(describeDeadlinePassed(deadline, now), "28 days ago",
        `a reading at ${hour}:00 disagreed with the printed date`);
    }
  });

  it("singularises exactly one day", () => {
    assert.equal(
      describeDeadlinePassed(new Date("2026-09-21T10:00:00Z"), new Date("2026-09-22T10:00:00Z")),
      "1 day ago",
    );
  });

  it("keeps the gate an advisory on a passed date, not a blocker", () => {
    const SRC = readFileSync("lib/engine/export-readiness.ts", "utf8");
    const idx = SRC.indexOf('"DEADLINE_PASSED"');
    assert.notEqual(idx, -1);
    assert.ok(SRC.slice(Math.max(0, idx - 300), idx).includes("advisoryWarnings.push"));
    assert.ok(SRC.slice(idx, idx + 300).includes('"HIGH"'));
    assert.ok(SRC.includes("effDeadline < now"));
  });

  it("carries no tender, sector or benchmark knowledge", () => {
    const SRC = readFileSync("lib/engine/export-readiness.ts", "utf8");
    const region = SRC.slice(SRC.indexOf("export function describeDeadlinePassed"));
    assert.equal(/pharo|ethiop|addis|healthcare|architect|consultanc/i.test(region), false);
  });
});
