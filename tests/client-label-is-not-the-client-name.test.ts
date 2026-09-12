import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";

/**
 * A compound client label must not be read as the client's name.
 *
 * "Procuring Entity / Client Name" is the ordinary way a tender data sheet
 * writes this row. The reader matched only the first word of that label and
 * treated the colon as optional, so the capture began mid-label and returned
 * the label's own tail: the client name came back as "/ Client Name", and the
 * colon form as "/ Client Name: <real name>".
 *
 * This is a critical field. It prints on the cover letter's "To:" line and
 * gates final export, so the failure either blocked a correctly extracted
 * tender or addressed the proposal to a fragment of its own form.
 *
 * No fixture wording is asserted here — the tenders below are invented and
 * deliberately unrelated to any benchmark. What is pinned is the shape.
 */

const client = (text: string) => parseTenderDocumentIntelligence(text).clientOrProcuringEntity;

test("a compound label is consumed as a label, not captured as the value", async (t) => {
  await t.test("colon form", () => {
    assert.equal(
      client("Procuring Entity / Client Name: Northern Roads Authority"),
      "Northern Roads Authority",
    );
  });

  await t.test("two-column table form, no colon anywhere", () => {
    assert.equal(
      client("Procuring Entity / Client Name\nNorthern Roads Authority"),
      "Northern Roads Authority",
    );
  });

  await t.test("a partial label row followed later by the full row", () => {
    assert.equal(
      client([
        "Procuring Entity / Client Name",
        "Northern Roads Authority",
        "Procuring Entity / Client Name: Northern Roads Authority",
      ].join("\n")),
      "Northern Roads Authority",
    );
  });

  await t.test("other compound spellings of the same row", () => {
    assert.equal(client("Employer / Client Name: Water Works Enterprise"), "Water Works Enterprise");
    assert.equal(client("Contracting Authority: Ministry of Education"), "Ministry of Education");
  });
});

test("the simple labels that already worked keep working", async (t) => {
  await t.test("bare Client", () => {
    assert.equal(client("Client: Northern Roads Authority"), "Northern Roads Authority");
  });

  await t.test("bare Procuring Entity", () => {
    assert.equal(client("Procuring Entity: Southern Water Board"), "Southern Water Board");
  });
});

test("the label tail must not cross into the next field", async (t) => {
  // The tail is bounded to labels ending in "name" for this reason: a
  // permissive tail matches "Client Contact Email:" and returns an address as
  // the client's name — a different wrong answer, not a fix.
  await t.test("a contact-email row does not become the client", () => {
    const value = client([
      "Client Contact Email: procurement@example.test",
      "Procuring Entity / Client Name: Northern Roads Authority",
    ].join("\n"));
    assert.equal(value, "Northern Roads Authority");
    assert.ok(!String(value).includes("@"), "an email address is never a client name");
  });

  await t.test("a value opening on a separator is rejected as a label fragment", () => {
    const value = client("Procuring Entity / Client Name: / Client Name");
    assert.ok(
      value === null || !/^[/&|,:;-]/.test(value),
      `expected no leading-separator fragment, got ${JSON.stringify(value)}`,
    );
  });
});
