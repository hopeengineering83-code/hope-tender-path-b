import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyConfirmedFactsToWriterTender, confirmedFactFields } from "../lib/engine/writer-tender-facts";

/**
 * THE DEFECT.
 * -----------
 * The app has a canonical authority for "what is this tender's client name,
 * deadline, reference, submission method and submission endpoint" —
 * resolveEffectiveTenderFacts() in lib/engine/effective-tender-facts.ts. It
 * merges the raw extracted scalar with the owner's TenderMetadataOverride row,
 * so a value the owner has corrected or confirmed wins over whatever the
 * parser pulled out of the PDF.
 *
 * TWO CONSUMERS USED IT AND THE WRITER DID NOT.
 *
 *   uses it : lib/engine/runtime-readiness-facts.ts  (readiness + export gates,
 *             via lib/canonical-release-decision.ts)
 *   uses it : app/api/tenders/[id]/fact-parity/route.ts  (diagnostic)
 *   did NOT : lib/engine/generate-elite.ts — the proposal writer
 *
 * generate-elite's tender load did not even select metadataOverrides, and
 * buildProposalIntelligence derives the client name from
 * `tender.clientName || tender.procuringEntityName` — the raw columns. The
 * override route is explicit that it never writes back:
 *
 *   "Only update the source-evidence columns (NOT the tender scalar,
 *    NOT the override)."
 *
 * So when an owner corrected a contaminated client name, the export gate
 * evaluated the package against the CORRECTED name and passed it, while the
 * document bytes were written from the UNCORRECTED one. Worse, the client-name
 * enforcer (generate-elite.ts, twice) then imposed the raw name across the
 * whole document — actively overwriting the correct name if the model had
 * happened to read it from the tender text.
 *
 * This is the same divergence family as the export blocker that named a check
 * which had passed: one surface reports a fact that another surface does not
 * act on. Here the gate's answer and the delivered bytes disagree about who
 * the client is.
 *
 * THE RULE PINNED HERE: a fact the owner has confirmed or edited must reach
 * the writer, and only such a fact may displace the raw extracted value.
 *
 * Fixtures are a municipal water utility and a rail resignalling programme, in
 * KES and NGN — deliberately not the Pharo benchmark, so the behaviour is
 * proven generic rather than tuned to one tender.
 */

type OverrideRow = Parameters<typeof applyConfirmedFactsToWriterTender>[1][number];

function override(partial: Partial<OverrideRow> & { field: string; fieldState: string }): OverrideRow {
  return {
    id: `ov-${partial.field}`,
    tenderId: "t-1",
    field: partial.field,
    fieldState: partial.fieldState,
    overrideValue: partial.overrideValue ?? null,
    reason: partial.reason ?? null,
    confirmationBasis: partial.confirmationBasis ?? null,
    confirmedAt: partial.confirmedAt ?? null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as OverrideRow;
}

const waterTender = {
  id: "t-1",
  title: "Consultancy for Non-Revenue Water Reduction, Phase II",
  reference: "NCWSC/CONS/2026/014",
  // What the parser pulled out: portal navigation text glued to the real name.
  clientName: "Home > Tenders > Open Tenders | Nairobi City Water and Sewerage Company",
  procuringEntityName: null,
  deadline: new Date("2026-03-02T11:00:00Z"),
  submissionMethod: "email",
  submissionAddress: null,
  submissionEmails: "tenders@example-ncwsc.co.ke",
  submissionEmailSubject: null,
  currency: "KES",
  country: "Kenya",
};

describe("a confirmed fact must reach the writer", () => {
  it("replaces a contaminated client name the owner corrected", () => {
    const result = applyConfirmedFactsToWriterTender(waterTender, [
      override({
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Nairobi City Water and Sewerage Company",
        reason: "Portal breadcrumb text was captured with the entity name.",
        confirmationBasis: "ITT cover page, section 1.1",
      }),
    ]);

    assert.equal(
      result.clientName,
      "Nairobi City Water and Sewerage Company",
      "the writer must receive the client name the owner corrected, not the contaminated scalar",
    );
  });

  it("leaves every field the owner has not touched exactly as extracted", () => {
    const result = applyConfirmedFactsToWriterTender(waterTender, [
      override({ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City Water and Sewerage Company" }),
    ]);

    assert.equal(result.reference, waterTender.reference);
    assert.equal(result.title, waterTender.title);
    assert.equal(result.submissionEmails, waterTender.submissionEmails);
    assert.equal(result.currency, "KES", "an unrelated confirmed-fact pass must not disturb currency");
    assert.equal(result.country, "Kenya");
  });

  it("does not mutate the tender record it was given", () => {
    const input = { ...waterTender };
    applyConfirmedFactsToWriterTender(input, [
      override({ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City Water and Sewerage Company" }),
    ]);
    assert.equal(
      input.clientName,
      waterTender.clientName,
      "the caller's row must be left alone; callers still read raw values for provenance reporting",
    );
  });

  it("keeps a deadline a Date, so downstream date formatting is unchanged", () => {
    const result = applyConfirmedFactsToWriterTender(waterTender, [
      override({ field: "deadline", fieldState: "USER_EDITED", overrideValue: "2026-03-09T11:00:00.000Z" }),
    ]);
    assert.ok(result.deadline instanceof Date, "deadline must stay a Date, not become a string");
    assert.equal((result.deadline as Date).toISOString(), "2026-03-09T11:00:00.000Z");
  });

  it("ignores an unparseable confirmed deadline rather than destroying the extracted one", () => {
    const result = applyConfirmedFactsToWriterTender(waterTender, [
      override({ field: "deadline", fieldState: "USER_EDITED", overrideValue: "sometime in March" }),
    ]);
    assert.equal(
      (result.deadline as Date).toISOString(),
      waterTender.deadline.toISOString(),
      "a value that cannot be a date must not blank the deadline the source did supply",
    );
  });

  it("does NOT adopt a candidate the owner rejected", () => {
    const result = applyConfirmedFactsToWriterTender(waterTender, [
      override({
        field: "clientName",
        fieldState: "REJECTED_CANDIDATE",
        overrideValue: "Athi Water Works Development Agency",
        reason: "Different entity; appears only in a cross-reference.",
      }),
    ]);
    assert.notEqual(
      result.clientName,
      "Athi Water Works Development Agency",
      "a rejected candidate must never become the name the proposal is addressed to",
    );
    assert.equal(result.clientName, waterTender.clientName);
  });

  it("does NOT blank a field the owner marked not-applicable", () => {
    // Deliberate: NOT_APPLICABLE / IGNORED_WITH_REASON tell the GATES the
    // source does not state this fact. They are not an instruction to hand the
    // writer an empty string, which is how placeholder text ("N/A",
    // "Bid-Team to confirm") gets into a client-facing document.
    const result = applyConfirmedFactsToWriterTender(waterTender, [
      override({ field: "submissionEmailSubject", fieldState: "NOT_APPLICABLE", reason: "No subject line is prescribed." }),
      override({ field: "reference", fieldState: "IGNORED_WITH_REASON", reason: "Superseded by addendum numbering." }),
    ]);
    assert.equal(result.reference, waterTender.reference);
    assert.equal(result.submissionEmailSubject, null);
  });

  it("carries a confirmed submission endpoint and method through together", () => {
    const railTender = {
      id: "t-2",
      title: "Design and Supervision, Lagos Rail Mass Transit Resignalling",
      reference: "LAMATA/RS/2026/003",
      clientName: "Lagos Metropolitan Area Transport Authority",
      deadline: new Date("2026-05-18T10:00:00Z"),
      submissionMethod: "hand delivery",
      submissionAddress: null,
      submissionEmails: null,
      currency: "NGN",
    };

    const result = applyConfirmedFactsToWriterTender(railTender, [
      override({ field: "submissionMethod", fieldState: "USER_CONFIRMED", overrideValue: "portal upload" }),
      override({
        field: "submissionAddress",
        fieldState: "USER_EDITED",
        overrideValue: "e-Procurement portal, Lagos State Public Procurement Agency",
      }),
    ]);

    assert.equal(result.submissionMethod, "portal upload");
    assert.equal(result.submissionAddress, "e-Procurement portal, Lagos State Public Procurement Agency");
    assert.equal(result.currency, "NGN", "a confirmed submission fact must not disturb an unrelated currency");
  });

  it("is a no-op when the tender has no overrides at all", () => {
    const result = applyConfirmedFactsToWriterTender(waterTender, []);
    for (const key of Object.keys(waterTender) as Array<keyof typeof waterTender>) {
      const before = waterTender[key];
      const after = result[key];
      if (before instanceof Date) {
        assert.equal((after as Date).toISOString(), before.toISOString(), `${String(key)} changed`);
      } else {
        assert.equal(after, before, `${String(key)} changed`);
      }
    }
  });

  it("the writer actually loads overrides and applies them", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(
      source,
      /metadataOverrides/,
      "generate-elite must select the override rows; without them the resolution above can never fire in production",
    );
    assert.match(
      source,
      /applyConfirmedFactsToWriterTender/,
      "generate-elite must apply confirmed facts before building the proposal intelligence",
    );
  });
  it("reports exactly which fields the owner confirmed", () => {
    const confirmed = confirmedFactFields(waterTender, [
      override({ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City Water and Sewerage Company" }),
      override({ field: "deadline", fieldState: "USER_CONFIRMED", overrideValue: "2026-03-09T11:00:00.000Z" }),
      override({ field: "reference", fieldState: "REJECTED_CANDIDATE", overrideValue: "NCWSC/CONS/2025/099" }),
      override({ field: "submissionEmailSubject", fieldState: "NOT_APPLICABLE" }),
    ]);
    assert.equal(confirmed.has("clientName"), true);
    assert.equal(confirmed.has("deadline"), true);
    assert.equal(confirmed.has("reference"), false, "a rejected candidate is not a confirmed fact");
    assert.equal(confirmed.has("submissionEmailSubject"), false, "not-applicable is not a confirmed fact");
  });

  it("reports nothing confirmed when there are no overrides", () => {
    assert.equal(confirmedFactFields(waterTender, []).size, 0);
  });

  it("a corrected deadline is not overruled by the quote it was corrected away from", () => {
    // formatSubmissionDeadline() prefers a date it can parse out of the stored
    // source quote over the deadline column. If the quote still travels
    // alongside an owner-corrected deadline, the document prints the misread
    // date the correction existed to remove.
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(
      source,
      /ownerConfirmedFields\.has\("deadline"\)\s*\?\s*null\s*:\s*tender\.deadlineSourceQuote/,
      "the deadline source quote must be withheld once the owner has confirmed a deadline",
    );
    assert.equal(
      /formatSubmissionDeadline\(tender\.deadline, tender\.deadlineSourceQuote\)/.test(source),
      false,
      "the raw deadline and its raw quote must no longer be formatted together",
    );
    assert.equal(
      /tenderDeadlineSourceQuote: tender\.deadlineSourceQuote/.test(source),
      false,
      "the deterministic fallback must not receive the raw quote alongside a confirmed deadline",
    );
  });

  it("every overridable fact the writer prints is read through the confirmed view", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    for (const field of ["reference", "submissionMethod", "submissionAddress", "submissionEmailSubject", "clientContactName"]) {
      assert.equal(
        new RegExp(`(?<!writer)[Tt]ender\\.${field}\\b`).test(source),
        false,
        `generate-elite still reads the raw tender.${field}; a confirmed value would not reach the document`,
      );
    }
  });
});
