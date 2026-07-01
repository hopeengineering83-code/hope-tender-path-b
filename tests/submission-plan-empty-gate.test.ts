import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const buildRoute = readFileSync("lib/engine/build-plan.ts", "utf8");
const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

describe("submission plan empty-state gates", () => {
  it("dedicated Build Plan route rejects zero planned files instead of returning ok:true", () => {
    // The preflight in build-plan.ts returns NO_PLAN_ITEMS when no plan items can be derived.
    assert.match(buildRoute, /NO_PLAN_ITEMS/);
  });

  it("generate planOnly mode rejects zero planned files before logging a successful plan build", () => {
    assert.match(generateRoute, /SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED/);
    assert.match(generateRoute, /planBuilt: false/);
    assert.match(generateRoute, /SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED/);
    assert.ok(
      generateRoute.indexOf("if (plannedFiles.length === 0) {") < generateRoute.indexOf("action: \"TENDER_PLAN_BUILT\""),
      "planOnly empty-plan blocker must run before successful build audit logging",
    );
  });
});
