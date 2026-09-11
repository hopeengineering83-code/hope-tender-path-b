// A refused Run Engine must leave a durable record that it happened.
//
// Reproduced defect. The owner ran Run Engine on tender 08e250af and reported
// it done. The database disagreed, conclusively (inspect 34604412559):
//
//   jobs anywhere on this account after 2026-09-10T19:14:01.740Z: 0
//   tenders visible to this account: ONE, updated 2026-09-10T19:15:33.872Z
//   currentOutputs 0, staleOutputs 33, every package rule PENDING_PACKAGE
//
// Not a failed job — no job at all, on the only tender the account has.
// enqueueEngineJob reuses a row only in QUEUED/RUNNING/PARTIAL_SUCCESS
// (enqueue-engine-job.ts), so a SUCCEEDED run does not suppress a new one and
// any click that reached the enqueue would have written a row. The request was
// refused above it — and every refusal path returned JSON and nothing else:
// no AiJob, no audit row, nothing any later inspection could read.
//
// An entire session went into diagnosing one instance and still could not name
// the cause, because the evidence was never written down. The owner sees even
// less: a button that appears to do nothing.
//
// This changes no decision and weakens no gate. The same requests are refused
// for the same reasons with the same status and body; only the record is new.
//
// Generic: nothing here is specific to a tender, a sector or a refusal reason.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const ROUTE = "app/api/tenders/[id]/engine/route.ts";
const src = readFileSync(ROUTE, "utf8");

describe("a refused Run Engine leaves a durable record", () => {
  it("every refusal after the tender is known goes through refuseEngineRun", () => {
    // The body of POST, from where the tender has been loaded onwards. Before
    // that point there is no tender to attribute a refusal to.
    const from = src.indexOf('code: "TENDER_NOT_FOUND"');
    assert.ok(from > -1, "the tender-not-found refusal should still exist");
    const body = src.slice(from);

    // A bare NextResponse.json(...) carrying an error code in this region is a
    // refusal that writes no record. The success response has no `code`.
    const bare = [...body.matchAll(/return NextResponse\.json\(\{[\s\S]{0,600}?\}/g)]
      .map((m) => m[0])
      .filter((block) => /\bcode:\s*["`]/.test(block));
    assert.deepEqual(
      bare,
      [],
      `these refusal paths return without leaving a record:\n${bare.join("\n---\n")}`,
    );
  });

  it("refuseEngineRun writes an audit row naming the refusal code", () => {
    const at = src.indexOf("async function refuseEngineRun");
    assert.ok(at > -1, "the helper must exist");
    const fn = src.slice(at, at + 2000);
    assert.match(fn, /await logAction\(/, "it must persist, not just log to stdout");
    assert.match(fn, /action: "TENDER_ENGINE_RUN_REFUSED"/);
    assert.match(fn, /entityId: args\.tenderId/, "the row must be attributable to the tender");
    assert.match(fn, /code,/, "the refusal code is the whole point of the record");
    assert.match(fn, /diagnosticId/, "and it must correlate with the response the owner saw");
  });

  it("the refusal code is distinct from a run that started and failed", () => {
    // TENDER_ENGINE_RUN_FAILED already exists and means something different: a
    // run began and then failed. Collapsing the two would make "the engine
    // never started" indistinguishable from "the engine broke".
    const audit = readFileSync("lib/audit.ts", "utf8");
    assert.match(audit, /"TENDER_ENGINE_RUN_REFUSED"/);
    assert.match(audit, /"TENDER_ENGINE_RUN_FAILED"/);
    assert.notEqual("TENDER_ENGINE_RUN_REFUSED", "TENDER_ENGINE_RUN_FAILED");
  });

  it("the decision itself is unchanged — same codes, same statuses", () => {
    // Guard against the fix quietly turning a refusal into an acceptance.
    for (const [code, status] of [
      ["TENDER_NOT_FOUND", "404"],
      ["NO_TENDER_FILES", "422"],
      ["CURRENT_ANALYSIS_REQUIRED", "422"],
      ["ANALYSIS_FROM_CORRUPTED_EXTRACTION", "422"],
      ["ANALYSIS_FROM_WEAK_EXTRACTION", "422"],
      ["COMPANY_VAULT_REQUIRED", "422"],
      ["COMPANY_VAULT_AUTO_PROMOTION_FAILED", "503"],
      ["ENGINE_SOURCE_REVISION_UNAVAILABLE", "503"],
    ] as const) {
      assert.match(src, new RegExp(`code: "${code}"`), `${code} must still be refused`);
      const at = src.indexOf(`code: "${code}"`);
      const around = src.slice(Math.max(0, at - 400), at + 400);
      assert.match(around, new RegExp(`status: ${status}`), `${code} must still return ${status}`);
    }
  });

  it("an audit failure cannot turn a refusal into a server error", () => {
    // logAction swallows its own failures; the helper must not add a throw
    // path of its own around it.
    const at = src.indexOf("async function refuseEngineRun");
    const fn = src.slice(at, at + 2000);
    assert.doesNotMatch(fn, /throw\b/, "the refusal path must not be able to throw");
  });
});
