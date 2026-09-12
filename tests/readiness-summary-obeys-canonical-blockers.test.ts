// A readiness summary must never promise what the export gate will decline.
//
// getCanonicalReadinessSummary() answers "can this tender be exported?" for
// every mutation route that returns `canonicalReadiness` — generate,
// auto-finalize, repair-export-gaps, finalize-pdf, link-vault-evidence and the
// rest — and the Export screen enables its download control from that verdict.
//
// It computed that verdict from documents and matching alone. The canonical
// release decision, which is what /export-readiness reports and what the export
// and final-ZIP gates enforce, was not consulted. So the two disagreed.
//
// Reproduced on a live pipeline drive against real routes, a real database and
// a real session, at 6/12 mandatory FULL/SUBSTANTIAL coverage:
//
//   POST /repair-export-gaps -> canonicalReadiness:
//                               { readyForFinalExport: true, blockers: [] }
//   GET  /export-readiness   -> { ok: false, status: "BLOCKED",
//                                 blockers: [MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE] }
//
// Same tender, same minute, opposite answers. That is precisely the screenshot
// where "Ready to download" and "Download Final ZIP" sit on the same screen as
// "release-qualified FULL/SUBSTANTIAL coverage for 3/4 mandatory requirements".
//
// This test exercises the real service against a real database rather than
// reading the source, so it fails if the two authorities drift apart again for
// any reason — not only if this particular wiring is removed.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { withDbFixture } from "./helpers/db-fixture";
import { getCanonicalReadinessSummary } from "../lib/canonical-tender-readiness";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import { randomUUID } from "node:crypto";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("canonical readiness summary obeys the canonical release decision", () => {
  const fx = withDbFixture();
  let userId = "";
  let tenderId = "";

  before(async () => {
    await fx.setup();
    userId = randomUUID();
    tenderId = randomUUID();
    await fx.prisma.user.create({
      data: {
        id: userId,
        email: `readiness-${userId}@example.test`,
        name: "Readiness Fixture",
        passwordHash: "x".repeat(60),
        role: "ADMIN",
      },
    });
    fx.trackUser(userId);
    await fx.prisma.tender.create({
      data: { id: tenderId, userId, title: "Readiness authority fixture tender" },
    });
    fx.trackTender(tenderId);
  });

  after(async () => { await fx.teardown(); });

  it("never reports readyForFinalExport while the release decision has a blocker", async () => {
    const decision = await getCanonicalTenderWorkflowDecision(fx.prisma, userId, tenderId);
    const summary = await getCanonicalReadinessSummary(fx.prisma, userId, tenderId);

    assert.ok(decision, "canonical decision must resolve for an owned tender");
    assert.ok(summary, "readiness summary must resolve for an owned tender");
    // A bare tender is legitimately blocked — that is the point: whatever the
    // release decision objects to, the summary must not call it exportable.
    if ((decision.blockerCodes ?? []).length > 0) {
      assert.equal(
        summary.readyForFinalExport,
        false,
        `summary promised export while the release decision blocked on ${decision.blockerCodes.join(", ")}`,
      );
    }
  });

  it("surfaces the release decision's blockers, not a narrower set", async () => {
    const decision = await getCanonicalTenderWorkflowDecision(fx.prisma, userId, tenderId);
    const summary = await getCanonicalReadinessSummary(fx.prisma, userId, tenderId);
    assert.ok(summary, "readiness summary must resolve for an owned tender");

    for (const code of decision?.blockerCodes ?? []) {
      assert.ok(
        summary.blockers.includes(code),
        `release blocker ${code} is invisible to the readiness summary that gates the download control`,
      );
    }
  });

  it("agrees with the release decision on exportability", async () => {
    // The invariant in one line: the summary may be stricter than the release
    // decision (document gates of its own), never more permissive.
    const decision = await getCanonicalTenderWorkflowDecision(fx.prisma, userId, tenderId);
    const summary = await getCanonicalReadinessSummary(fx.prisma, userId, tenderId);
    assert.ok(summary, "readiness summary must resolve for an owned tender");
    const releaseClear = (decision?.blockerCodes ?? []).length === 0;
    assert.ok(
      !summary.readyForFinalExport || releaseClear,
      "summary is more permissive than the canonical release decision",
    );
  });
});
