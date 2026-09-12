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


  it("the record is readable, not just written", () => {
    // Writing a row nobody can read is still a silent failure. The
    // owner-facing /api/audit feed deliberately scrubs descriptions to canned
    // text and drops metadata (lib/audit-log-presentation.ts), and relabels
    // any action missing from its map as the generic "AUDIT_EVENT" — so on
    // the only existing read path the refusal code was invisible and the
    // event did not even name itself. Both halves are fixed:
    const presentation = readFileSync("lib/audit-log-presentation.ts", "utf8");
    assert.match(
      presentation,
      /TENDER_ENGINE_RUN_REFUSED: "/,
      "the owner's activity feed must name a refusal instead of showing AUDIT_EVENT",
    );

    const diag = readFileSync("app/api/admin/engine-refusals/route.ts", "utf8");
    assert.match(diag, /requireRole\("ADMIN"\)/, "the detailed read must stay admin-only");
    assert.match(diag, /action: "TENDER_ENGINE_RUN_REFUSED"/);
    for (const field of ["code", "httpStatus", "nextAction", "diagnosticId"]) {
      assert.match(diag, new RegExp(`${field}:`), `the diagnostic must surface ${field}`);
    }
    // It is a read path and must never become a write path.
    for (const write of ["prisma.auditLog.create", "prisma.auditLog.update", "prisma.auditLog.delete",
                         "prisma.tender.update", "prisma.aiJob.create"]) {
      assert.doesNotMatch(diag, new RegExp(write.replace(/\./g, "\\.")), `${write} must not appear in a diagnostic read`);
    }
  });

  it("an empty refusal list is reported as an answer, not as silence", () => {
    // "No rows" means something specific — either no click reached the server,
    // or every click that did was accepted. Returning a bare [] would leave
    // the next reader to guess, which is the whole failure mode being fixed.
    const diag = readFileSync("app/api/admin/engine-refusals/route.ts", "utf8");
    assert.match(diag, /meaning:/);
    assert.match(diag, /No Run Engine refusal has been recorded/);
  });

  it("an audit failure cannot turn a refusal into a server error", () => {
    // logAction swallows its own failures; the helper must not add a throw
    // path of its own around it.
    const at = src.indexOf("async function refuseEngineRun");
    const fn = src.slice(at, at + 2000);
    assert.doesNotMatch(fn, /throw\b/, "the refusal path must not be able to throw");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The first fix (f3e17913) instrumented only the refusals BELOW the point
  // where the tender is loaded. Re-reading the route against the live evidence
  // showed three exits it never covered, and they are precisely the ones that
  // fit what actually happened: no AiJob, no audit row, nothing.
  //
  //   * CLIENT_POLICY_OVERRIDE_REJECTED (400) and RATE_LIMITED (429) sat ABOVE
  //     `await params`, so there was no tender id to attribute a row to. The
  //     id is now resolved first; nothing else about either decision changed.
  //   * The terminal catch — anything thrown inside the try, including the
  //     enqueue itself — returned a mapped error and wrote nothing durable.
  //
  // A click that dies in the catch is indistinguishable afterwards from a
  // click that was never made. That is the whole defect, so the catch is the
  // most important of the three.
  // ───────────────────────────────────────────────────────────────────────────

  it("the tender id is resolved before the first refusal can happen", () => {
    const idAt = src.indexOf("const { id } = await params;");
    assert.ok(idAt > -1, "the route must still resolve the tender id");
    for (const code of ["CLIENT_POLICY_OVERRIDE_REJECTED", "RATE_LIMITED"]) {
      const at = src.indexOf(code);
      assert.ok(at > -1, `${code} should still exist`);
      assert.ok(
        idAt < at,
        `${code} is refused before the tender id is known, so it cannot be recorded`,
      );
    }
  });

  it("the policy-override and rate-limit refusals are recorded like the rest", () => {
    for (const code of ["CLIENT_POLICY_OVERRIDE_REJECTED", "RATE_LIMITED"]) {
      const at = src.indexOf(code);
      // Look back from the code to the start of its return statement.
      const head = src.lastIndexOf("return ", at);
      const stmt = src.slice(head, at);
      assert.match(
        stmt,
        /refuseEngineRun|const refusal = await refuseEngineRun/,
        `${code} still returns without leaving a record`,
      );
    }
  });

  it("rate limiting keeps its Retry-After header after being recorded", () => {
    // Recording must not quietly drop a header a client depends on.
    const at = src.indexOf('code: "RATE_LIMITED"');
    const region = src.slice(at, at + 400);
    assert.match(region, /Retry-After/, "the 429 must still tell the client when to retry");
  });

  it("a throw anywhere in the run leaves a record too", () => {
    const at = src.lastIndexOf("} catch (error) {");
    assert.ok(at > -1, "the terminal catch must still exist");
    const block = src.slice(at);
    assert.match(block, /await logAction\(/, "a thrown Run Engine must persist something");
    assert.match(block, /action: "TENDER_ENGINE_RUN_REFUSED"/);
    assert.match(block, /entityId: id/, "the record must name the tender");
    assert.match(block, /errorName/, "the record must say what threw");
  });

  it("the thrown-run record distinguishes 'no run exists' from 'run exists'", () => {
    // Claiming nothing was created when the enqueue already succeeded would be
    // a false record, which is worse than no record: the next reader would
    // stop looking for a job that is really there.
    assert.match(src, /let enqueuedJobId: string \| null = null;/,
      "the route must track whether a durable job was created");
    assert.match(src, /enqueuedJobId = enqueueResult\.id;/,
      "the flag must be set at the enqueue, not guessed");
    const block = src.slice(src.lastIndexOf("} catch (error) {"));
    assert.match(block, /enqueuedJobId\s*\n?\s*\?/, "the description must branch on it");
    assert.match(block, /enqueuedJobId,/, "and the id must be in the metadata");
  });
});
