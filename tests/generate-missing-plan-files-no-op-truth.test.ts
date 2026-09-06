// A generation run that changed nothing must not report success.
//
// POST /generate-missing-plan-files ended with an unconditional
// {success: true, created: created.length, updated: updated.length}. When every
// target was skipped, that is HTTP 200, success true, created 0, updated 0 — a
// complete no-op presented as completion. The button then rendered
// "0 missing planned file records created/updated" in its success style, with
// no reason attached, so the only thing left to try was clicking again, which
// produced exactly the same thing.
//
// That is the shape of defect this app is meant not to have: the user uploads
// the documents and the app finishes the job, so when the app cannot finish it
// has to say which target stopped it and why — not report a cheerful zero.
//
// The "nothing was missing in the first place" case is different and still
// returns success: there was no work to do, and nothing is blocked.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// The implementation of this route now lives in
// lib/engine/missing-plan-file-generation.ts so the auto-finalize worker can
// run the same code with the same gates. Read both halves of the path — the
// assertions here are about what the path does, not which file holds it.
const ROUTE = readFileSync("app/api/tenders/[id]/generate-missing-plan-files/route.ts", "utf8")
  + readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
const BUTTON = readFileSync("components/generate-missing-plan-files-button.tsx", "utf8");

describe("A no-op generation run is reported as a failure with reasons", () => {
  it("counts every kind of change before deciding the run succeeded", () => {
    // Assert the invariant, not one spelling of the sum. This previously pinned
    // the exact expression, so adding a fourth kind of change — planning a row
    // for a file that must arrive as an official original — failed the test for
    // doing precisely what the test exists to require.
    const sum = ROUTE.match(/const changedCount = ([^;]+);/)?.[1] ?? "";
    assert.ok(sum.length > 0, "changedCount must be computed in one place");
    for (const counter of ["created", "updated", "convertedFromPlanned", "plannedCreated"]) {
      assert.ok(
        sum.includes(`${counter}.length`),
        `${counter} rows are real changes and must count toward success (changedCount = ${sum})`,
      );
    }
  });

  it("refuses success when nothing changed", () => {
    // The service decides (ok:false, status 422, coded reason); the route maps
    // that onto the HTTP response. Both halves are asserted so neither can drop
    // the refusal.
    assert.match(ROUTE, /if \(changedCount === 0\) \{/);
    assert.match(ROUTE, /code: "NO_PLANNED_FILE_COULD_BE_GENERATED"/);
    assert.match(ROUTE, /ok: false, status: 422/);
    assert.match(ROUTE, /success: false/);
    assert.match(ROUTE, /\{ status: result\.status \}/);
  });

  it("returns the per-target skip reasons rather than only a count", () => {
    // The no-change result carries every per-target list, and the route hands
    // them all to the caller under `files`. Matched by name rather than as one
    // object literal so the set can grow without failing a test whose point is
    // that the lists are returned at all.
    const block = ROUTE.slice(ROUTE.indexOf("if (changedCount === 0)"));
    for (const list of ["created", "updated", "convertedFromPlanned", "plannedCreated", "skipped"]) {
      assert.ok(
        new RegExp(`\\b${list}\\b`).test(block),
        `the failure result must carry the ${list} list`,
      );
    }
    assert.match(block, /nextAction: skipped\.length > 0 \? "REVIEW_SKIPPED_TARGETS" : "RUN_ENGINE"/);
    // The route must forward them rather than collapsing to a bare count.
    const files = ROUTE.match(/const files = \{([\s\S]*?)\};/)?.[1] ?? "";
    assert.ok(files.length > 0, "the route must build the per-target file lists for the caller");
    for (const list of ["created", "updated", "convertedFromPlanned", "plannedCreated", "skipped"]) {
      assert.ok(files.includes(list), `the response must return the ${list} list (files: {${files}})`);
    }
  });

  it("distinguishes 'nothing was missing' from 'nothing could be done'", () => {
    // The early return for an already-complete plan legitimately succeeds.
    assert.match(ROUTE, /message: "No missing planned files remain\."/);
    const earlyReturn = ROUTE.slice(0, ROUTE.indexOf("const skipped: string[] = []"));
    assert.match(earlyReturn, /success: true, created: 0, updated: 0/);
  });

  it("keeps the success path for runs that did change something", () => {
    assert.match(ROUTE, /return NextResponse\.json\(\{\n    success: true,\n    created: result\.created\.length,/);
  });
});

describe("The button states which targets were skipped", () => {
  it("reads the skipped list from the response", () => {
    assert.match(BUTTON, /skipped\?: string\[\]/);
    assert.match(BUTTON, /const skipped = data\.files\?\.skipped \?\? \[\];/);
  });

  it("renders the reasons instead of a bare count", () => {
    assert.match(BUTTON, /Skipped: \$\{skipped\.join\("; "\)\}/);
  });

  it("tells the user that retrying unchanged will repeat the result", () => {
    assert.match(BUTTON, /REVIEW_SKIPPED_TARGETS/);
    assert.match(BUTTON, /repeats this result/);
  });
});
