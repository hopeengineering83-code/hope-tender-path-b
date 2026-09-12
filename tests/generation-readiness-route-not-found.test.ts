// Regression test for a real, reproduced bug: GET /api/tenders/[id]/generation-readiness
// returned 500 instead of 404 for a nonexistent tender.
//
// Root cause: the route called getFinalPackageReadinessModel(prisma, tenderId, userId)
// inside the same Promise.all as the tender-existence lookup. That function throws
// Error("Tender not found") for a nonexistent tender (final-package-readiness-model.ts),
// which rejects the whole Promise.all before the route's own `if (!readiness || !tender)
// return 404` check ever runs — so the generic catch-all handler turned an expected
// "tender doesn't exist" case into an unexpected 500.
//
// Reproduced directly against a running server: authenticated GET for a random UUID
// returned {"error":"Generation readiness panel failed to load.", "code":
// "GENERATION_READINESS_RUNTIME_ERROR"} with status 500 before the fix, and
// {"error":"Tender not found"} with status 404 after — with no change in behavior
// for a real, existing tender (still 200).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/generation-readiness/route.ts", "utf8");

describe("generation-readiness route — tender-not-found returns 404, not 500", () => {
  it("resolves the tender-existence check before calling getFinalPackageReadinessModel", () => {
    const notFoundCheckIndex = source.indexOf("if (!readiness || !tender)");
    const finalPackageCallIndex = source.indexOf("getFinalPackageReadinessModel(prisma, tenderId, userId)", source.indexOf("await prismaReady"));
    assert.ok(notFoundCheckIndex !== -1, "route must have the not-found check");
    assert.ok(finalPackageCallIndex !== -1, "route must call getFinalPackageReadinessModel");
    assert.ok(
      notFoundCheckIndex < finalPackageCallIndex,
      "the not-found check must run BEFORE getFinalPackageReadinessModel is called — that function throws for a nonexistent tender, and previously being called inside the same Promise.all as the tender lookup meant the throw reached the generic 500 handler before the 404 check could run",
    );
  });

  it("does not call getFinalPackageReadinessModel inside the initial Promise.all", () => {
    const promiseAllBlock = source.slice(source.indexOf("await Promise.all(["), source.indexOf("]);") + 3);
    assert.ok(
      !promiseAllBlock.includes("getFinalPackageReadinessModel"),
      "getFinalPackageReadinessModel must not be inside the Promise.all that runs before the tender-not-found check",
    );
  });
});
