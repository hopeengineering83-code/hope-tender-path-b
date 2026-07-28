import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
const autoFinalizeRoute = readFileSync("app/api/tenders/[id]/auto-finalize/route.ts", "utf8");

describe("signature and stamp remain an explicit legal approval gate", () => {
  it("generation owners never apply uploaded signature or stamp assets automatically", () => {
    for (const route of [generateRoute, autoFinalizeRoute]) {
      assert.doesNotMatch(route, /applyActiveSignatureAndStampToTenderDocuments/);
      assert.doesNotMatch(route, /signature auto-applied|stamp auto-applied/i);
    }
  });

  it("has no competing automatic signature/stamp mutation service", () => {
    assert.equal(
      existsSync("lib/engine/apply-signature-stamp.ts"),
      false,
      "a background generation path must not be able to manufacture legal approval by mutating every DOCX",
    );
  });
});
