import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";

/**
 * A later authoritative addendum supersedes the deadline it explicitly changes.
 *
 * Real tenders are amended: an original, then a clarification, then a
 * corrigendum extending the closing date, sometimes twice. The reader saw only
 * a flat concatenation of every active source file and took the first complete
 * date in it, which is the ORIGINAL — so a tender extended by three weeks was
 * still worked to its superseded deadline, and one already past its original
 * date still read as expired after being extended.
 *
 * Precedence here is never upload order. A file being appended later is not
 * procurement authority. Authority comes from what the source says: explicit
 * amendment language ("extended to", "revised to"), and an addendum number
 * where more than one amendment exists. When those cannot order the
 * amendments, nothing is chosen and the absence is reported — a guessed
 * deadline is worse than a missing one.
 *
 * Wording below is invented and unrelated to any benchmark.
 */

const iso = (text: string) => parseTenderDocumentIntelligence(text).submissionInstructions.deadlineIso;
const warnings = (text: string) => parseTenderDocumentIntelligence(text).warnings;

const ORIGINAL = [
  "REQUEST FOR PROPOSAL",
  "Procuring Entity / Client Name: Northern Roads Authority",
  "Submission Deadline: 10 March 2027 at 14:00 local time.",
  "Submission Method: Email",
  "Submission Email: procurement@nra.example",
].join("\n");

const ADDENDUM_1 = [
  "ADDENDUM NO. 1",
  "The submission deadline is hereby extended to 24 March 2027 at 14:00 local time.",
  "All other terms of the original Request for Proposal remain unchanged.",
].join("\n");

const ADDENDUM_2 = [
  "ADDENDUM NO. 2",
  "The submission deadline is hereby further extended to 07 April 2027 at 14:00 local time.",
].join("\n");

const join = (...parts: string[]) => parts.join("\n\n---\n\n");

test("CASE 1 — with no amendment the original stands", () => {
  assert.equal(iso(ORIGINAL), "2027-03-10T14:00:00.000Z");
});

test("CASE 2 — one explicit extension supersedes the original", () => {
  assert.equal(iso(join(ORIGINAL, ADDENDUM_1)), "2027-03-24T14:00:00.000Z");
});

test("CASE 3 — the latest of several extensions wins", () => {
  assert.equal(iso(join(ORIGINAL, ADDENDUM_1, ADDENDUM_2)), "2027-04-07T14:00:00.000Z");
});

test("CASE 4 — quoting the old date is not an amendment", () => {
  // A clarification that merely repeats the original date, with no amending
  // language, must not roll the deadline back.
  const clarification = [
    "CLARIFICATION NOTE",
    "Question: the original notice stated a deadline of 10 March 2027. Please confirm the venue.",
    "Answer: the venue is unchanged.",
  ].join("\n");
  assert.equal(iso(join(ORIGINAL, ADDENDUM_1, clarification)), "2027-03-24T14:00:00.000Z");
});

test("CASE 5 — an explicit revision of the extension wins", () => {
  const revision = [
    "ADDENDUM NO. 2",
    "Addendum No. 1 is hereby rescinded. The submission deadline is revised to 15 April 2027 at 10:00 local time.",
  ].join("\n");
  assert.equal(iso(join(ORIGINAL, ADDENDUM_1, revision)), "2027-04-15T10:00:00.000Z");
});

test("CASE 6 — unorderable conflicting amendments fail closed", async (t) => {
  // Two amendments, neither numbered nor dated: nothing in the source says
  // which is later. Upload order is not authority, so no deadline is reported.
  const a = "ADDENDUM\nThe submission deadline is extended to 24 March 2027 at 14:00 local time.";
  const b = "ADDENDUM\nThe submission deadline is extended to 31 March 2027 at 14:00 local time.";

  await t.test("no deadline is chosen", () => {
    assert.equal(iso(join(ORIGINAL, a, b)), null);
  });

  await t.test("the conflict is reported rather than hidden", () => {
    assert.ok(
      warnings(join(ORIGINAL, a, b)).some((w) => /deadline/i.test(w)),
      "an unresolved deadline conflict must surface as a warning",
    );
  });
});

test("CASE 7 — an extension past an expired original is honoured", () => {
  const expired = ORIGINAL.replace("10 March 2027", "10 March 2020");
  assert.equal(iso(join(expired, ADDENDUM_1)), "2027-03-24T14:00:00.000Z");
});

test("CASE 8 — amendments are read in the ordinary date formats", async (t) => {
  const amend = (d: string) =>
    iso(join(ORIGINAL, `ADDENDUM NO. 1\nThe submission deadline is extended to ${d}`));

  await t.test("month-first with a named timezone", () => {
    assert.equal(amend("August 25, 2027, 5:00 PM Addis Ababa Time"), "2027-08-25T17:00:00+03:00");
  });

  await t.test("day-first with a generic clock phrase", () => {
    assert.equal(amend("25 August 2027 at 17:00 local time."), "2027-08-25T17:00:00.000Z");
  });

  await t.test("an unambiguous numeric date", () => {
    assert.equal(amend("25/08/2027 17:00"), "2027-08-25T17:00:00.000Z");
  });

  await t.test("a dayless amendment is refused, leaving the prior deadline", () => {
    // The amendment states no day, so it amends nothing; completing it would
    // invent a date, and discarding the known deadline would lose one.
    assert.equal(amend("August, 2027"), "2027-03-10T14:00:00.000Z");
  });
});

test("CASE 9 — other dated events are not the submission deadline", async (t) => {
  const other = (line: string) => iso(join(ORIGINAL, `ADDENDUM NO. 1\n${line}`));

  await t.test("clarification-question deadline", () => {
    assert.equal(other("The deadline for clarification questions is extended to 01 March 2027."), "2027-03-10T14:00:00.000Z");
  });

  await t.test("pre-bid meeting", () => {
    assert.equal(other("The pre-bid meeting is moved to 05 March 2027 at 10:00."), "2027-03-10T14:00:00.000Z");
  });

  await t.test("bid validity period", () => {
    assert.equal(other("The bid validity period is extended to 30 September 2027."), "2027-03-10T14:00:00.000Z");
  });

  await t.test("contract start date", () => {
    assert.equal(other("The contract start date is revised to 01 June 2027."), "2027-03-10T14:00:00.000Z");
  });
});

test("CASE 10 — an addendum changes only what it states", () => {
  // A deadline extension must not disturb the submission channel.
  const parsed = parseTenderDocumentIntelligence(join(ORIGINAL, ADDENDUM_1));
  assert.equal(parsed.submissionInstructions.deadlineIso, "2027-03-24T14:00:00.000Z");
  assert.deepEqual(parsed.submissionInstructions.emails, ["procurement@nra.example"]);
  assert.equal(parsed.submissionInstructions.method, "Email");
  assert.equal(parsed.clientOrProcuringEntity, "Northern Roads Authority");
});
