import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";

/**
 * A deadline the source does not state must not be invented, and a deadline it
 * does state must be found even when an earlier row is incomplete.
 *
 * `new Date("August, 2026, 5:00 PM")` is not an error — it silently returns
 * August 1st. A tender whose summary row omits the day therefore acquired a
 * deadline appearing nowhere in it, twenty-four days before the real one on a
 * real document, which reads downstream as an expired or nearly expired tender.
 *
 * The reader also stopped at its first candidate. Tenders state the deadline
 * more than once — a summary row near the front and the full instruction later —
 * and the summary row is exactly where the day goes missing, so giving up on the
 * first match discarded the complete date sitting further down the same file.
 *
 * Same family as the pricing gate that reported a price no sentence contained:
 * a reader may report what the source says, or report nothing, never a value it
 * completed by itself.
 *
 * Wording below is invented and unrelated to any benchmark; the shapes are what
 * is pinned.
 */

const deadline = (text: string) => parseTenderDocumentIntelligence(text).submissionInstructions;

test("a date with no day of the month is refused, not completed", async (t) => {
  await t.test("month and year alone yields nothing", () => {
    const r = deadline("Submission Deadline: November, 2027, 4:00 PM");
    assert.equal(r.deadlineIso, null);
    assert.equal(r.deadlineDisplay, null);
  });

  await t.test("it does not silently become the first of the month", () => {
    const r = deadline("Submission Deadline: November, 2027, 4:00 PM");
    assert.ok(
      !String(r.deadlineIso).includes("11-01"),
      `a day the source never states must not appear, got ${JSON.stringify(r.deadlineIso)}`,
    );
  });

  await t.test("the absence is reported rather than passed over in silence", () => {
    const parsed = parseTenderDocumentIntelligence("Submission Deadline: November, 2027, 4:00 PM");
    assert.ok(
      parsed.warnings.some((w) => /deadline/i.test(w)),
      "a missing deadline must surface as a warning",
    );
  });
});

test("a complete date later in the document wins over an incomplete row above it", () => {
  const r = deadline([
    "Submission Deadline",
    " November, 2027, 4:00 PM",
    "SECTION II - SUBMISSION",
    "Submission Deadline: November 18, 2027, 4:00 PM",
  ].join("\n"));
  assert.equal(r.deadlineIso, "2027-11-18T16:00:00.000Z");
});

test("the ordinary ways a deadline is written all parse", async (t) => {
  const iso = (s: string) => deadline(s).deadlineIso;

  await t.test("month-first", () => {
    assert.equal(iso("Submission Deadline: November 18, 2027, 4:00 PM"), "2027-11-18T16:00:00.000Z");
  });

  await t.test("day-first, which most of the world writes", () => {
    // The connector "at" alone made this unparseable, so such a tender
    // previously carried no deadline whatsoever.
    assert.equal(iso("Submission Deadline: 18 November 2027 at 14:00"), "2027-11-18T14:00:00.000Z");
  });

  await t.test("ISO", () => {
    assert.equal(iso("Submission Deadline: 2027-11-18 14:00"), "2027-11-18T14:00:00.000Z");
  });

  await t.test("sentence form ending in a full stop", () => {
    assert.equal(
      iso("Proposals must be submitted by 18 November 2027 at 14:00."),
      "2027-11-18T14:00:00.000Z",
    );
  });

  await t.test("a named timezone is honoured rather than dropped", () => {
    assert.equal(
      iso("Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time"),
      "2026-08-25T17:00:00+03:00",
    );
  });
});

test("an unambiguous all-numeric date parses whichever way round it is written", async (t) => {
  const iso = (s: string) => deadline(s).deadlineIso;

  await t.test("day-first, the ordinary form outside the United States", () => {
    // Date rejects this outright rather than misreading it, so such a tender
    // previously carried no deadline whatsoever.
    assert.equal(iso("Submission Deadline: 18/11/2027 14:00"), "2027-11-18T14:00:00.000Z");
  });

  await t.test("month-first", () => {
    assert.equal(iso("Submission Deadline: 11/18/2027 14:00"), "2027-11-18T14:00:00.000Z");
  });

  await t.test("hyphen separators", () => {
    assert.equal(iso("Submission Deadline: 18-11-2027"), "2027-11-18T00:00:00.000Z");
  });
});

test("an ambiguous all-numeric date is refused rather than guessed", () => {
  // 05/11/2027 is the 5th of November to most of the world and the 11th of May
  // to the rest. Picking one silently is the same defect as completing a
  // missing day, so nothing is reported until the source is unambiguous.
  const r = deadline("Submission Deadline: 05/11/2027 14:00");
  assert.equal(r.deadlineIso, null);
});
