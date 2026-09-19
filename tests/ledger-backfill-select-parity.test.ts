// The ledger backfill reads client-detail values off a Prisma row, and that row
// comes from a query with an explicit `select`. The two lists must agree, and
// nothing enforces that they do.
//
// This is not hypothetical. `clientCity` was added to `clientDetailFields` and
// the suite stayed red: the column was not in the `select`, so it arrived as
// `undefined`, `buildBackfillCandidates` skipped it via its own empty-string
// guard, and no row was created. No error, no warning — a client field silently
// absent from the one surface a reviewer uses to check traceability. The comment
// above the `select` already warns about exactly this, which is the clearest
// possible sign that a comment is not enough.
//
// The behavioural suite next door proves the twelve fields known today. It
// cannot catch a thirteenth added to one list and not the other, because it only
// knows the twelve. This test derives both lists from the source, so a new field
// is covered the moment it is written.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SERVICE_PATH = "lib/engine/tender-facts-ledger-service.ts";
const source = readFileSync(SERVICE_PATH, "utf8");

/** The `clientDetailFields` array literal, which drives candidate creation. */
function clientDetailFieldBlock(): string {
  const start = source.indexOf("const clientDetailFields");
  assert.notEqual(start, -1, `${SERVICE_PATH} must still declare clientDetailFields`);
  const end = source.indexOf("];", start);
  assert.notEqual(end, -1, "clientDetailFields must be a closed array literal");
  return source.slice(start, end);
}

/** The `select` object of the backfill's tender query. */
function backfillSelectBlock(): string {
  const marker = "contactDetailsSourceJson: true,";
  const end = source.indexOf(marker);
  assert.notEqual(end, -1, "the backfill select must still request contactDetailsSourceJson");
  const start = source.lastIndexOf("select: {", end);
  assert.notEqual(start, -1, "the backfill select block must be locatable");
  return source.slice(start, end + marker.length);
}

describe("ledger backfill reads every column its candidate list depends on", () => {
  it("selects every Tender column that clientDetailFields reads", () => {
    const fields = clientDetailFieldBlock();
    const columns = [...fields.matchAll(/value:\s*tender\.(\w+)/g)].map((m) => m[1]);

    assert.ok(
      columns.length >= 12,
      `expected the twelve known client-detail columns, found ${columns.length} — did the list move?`,
    );

    const select = backfillSelectBlock();
    const missing = columns.filter((column) => !new RegExp(`\\b${column}:\\s*true`).test(select));

    assert.deepEqual(
      missing,
      [],
      `these columns are read by clientDetailFields but never selected, so they arrive as undefined and are ` +
        `silently skipped: ${missing.join(", ")}. Add them to the backfill select.`,
    );
  });

  it("keeps the field list and the ledger keys in step", () => {
    // Each client-detail entry writes a row under its own semanticKey. When the
    // key and the column drift apart, the row is written under a name no reader
    // is looking for — which fails just as quietly as not writing it at all.
    const fields = clientDetailFieldBlock();
    const pairs = [...fields.matchAll(/value:\s*tender\.(\w+),\s*semanticKey:\s*"(\w+)"/g)];

    assert.ok(pairs.length >= 12, `expected at least twelve client-detail entries, found ${pairs.length}`);

    const mismatched = pairs.filter(([, column, key]) => column !== key).map(([, column, key]) => `${column} → "${key}"`);

    assert.deepEqual(
      mismatched,
      [],
      `every client-detail semanticKey is expected to match its Tender column so provenance recorded in ` +
        `contactDetailsSourceJson (keyed by the same names) can be found: ${mismatched.join(", ")}`,
    );
  });
});
