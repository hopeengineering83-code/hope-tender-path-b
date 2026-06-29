import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const buildRoute = readFileSync("app/api/tenders/[id]/submission-plan/build/route.ts", "utf8");
const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

describe("submission plan empty-state gates", () => {
  it("dedicated Build Plan route rejects zero planned files instead of returning ok:true", () => {
    assert.match(buildRoute, /if \(plannedFiles\.length === 0\) \{/);
    assert.match(buildRoute, /SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED/);
    assert.match(buildRoute, /REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN/);
    assert.ok(
      buildRoute.indexOf("if (plannedFiles.length === 0) {") < buildRoute.indexOf("const created = 0"),
      "empty plan blocker must run before any GeneratedDocument rows are created",
    );
  });

  it("generate planOnly mode rejects zero planned files before logging a successful plan build", () => {
    assert.match(generateRoute, /if \(plannedFiles\.length === 0\) \{/);
    assert.match(generateRoute, /planBuilt: false/);
    assert.match(generateRoute, /SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED/);
    assert.ok(
      generateRoute.indexOf("if (plannedFiles.length === 0) {") < generateRoute.indexOf("action: \"TENDER_PLAN_BUILT\""),
      "planOnly empty-plan blocker must run before successful build audit logging",
    );
  });
});
