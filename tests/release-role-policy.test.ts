import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const MUTATION_ROUTES = [
  "app/api/tenders/[id]/approve-analysis/route.ts",
  "app/api/tenders/[id]/auto-finalize/route.ts",
  "app/api/tenders/[id]/repair-export-gaps/route.ts",
  "app/api/tenders/[id]/requirement-coverage/reject/route.ts",
    "app/api/tenders/[id]/supersede-outside-plan/route.ts",
  "app/api/tenders/[id]/link-vault-evidence/route.ts",
  "app/api/tenders/[id]/link-vault-evidence-auto/route.ts",
  "app/api/tenders/[id]/submission-plan/build/route.ts",
  "app/api/tenders/[id]/generate-missing-plan-files/route.ts",
  "app/api/tenders/[id]/build-plan/route.ts",
  "app/api/tenders/[id]/build-plan/confirm/route.ts",
  "app/api/tenders/[id]/download/route.ts",
  "app/api/tenders/[id]/metadata-override/route.ts",
  "app/api/tenders/[id]/repair-source-grounding/route.ts",
  "app/api/tenders/[id]/repair-metadata/route.ts",
  "app/api/tenders/[id]/validate/route.ts",
  "app/api/tenders/[id]/authority-review/route.ts",
  "app/api/tenders/[id]/evaluator-objections/route.ts",
  "app/api/tenders/[id]/advisory-resolutions/route.ts",
  "app/api/tenders/[id]/requirement-coverage/route.ts",
  "app/api/tenders/[id]/gaps/[gapId]/route.ts",
];

describe("release-authority mutation routes exclude REVIEWER", () => {
  for (const file of MUTATION_ROUTES) {
    it(`${file} does not grant REVIEWER mutation authority`, () => {
      assert.equal(existsSync(file), true, `${file} must exist`);
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER",\s*"REVIEWER"\)/,
        `${file} must NOT grant REVIEWER mutation authority`);
    });
  }
});
