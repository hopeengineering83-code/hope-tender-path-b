// Owner-directed policy: the App applies the company's own uploaded signature
// and stamp itself. There is no per-document human approval step, exactly as
// there is none for the uploaded letterhead — both are brand assets the owner
// uploaded once, and both are applied by the same generation path.
//
// A prior audit pass deleted lib/engine/apply-signature-stamp.ts and asserted
// the opposite contract here, reasoning that a background path "must not
// manufacture legal approval". That reasoning was applied inconsistently — it
// left applyActiveUploadedLetterheadToTenderDocuments untouched, which mutates
// every generated DOCX on exactly the same terms — and it contradicted the
// product owner's explicit instruction. What actually matters is that the
// applier cannot invent anything and cannot escape the tender's own rules, so
// this file pins those real safety rails instead of pinning the feature's
// absence.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const applier = readFileSync("lib/engine/apply-signature-stamp.ts", "utf8");
const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
const autoFinalizeRoute = readFileSync("app/api/tenders/[id]/auto-finalize/route.ts", "utf8");

describe("signature and stamp are applied automatically from owner-uploaded assets", () => {
  it("the canonical applier exists and is the single implementation", () => {
    assert.equal(existsSync("lib/engine/apply-signature-stamp.ts"), true);
    assert.match(applier, /export async function applyActiveSignatureAndStampToTenderDocuments/);
  });

  it("both generation owners apply it, with no human approval step in between", () => {
    for (const route of [generateRoute, autoFinalizeRoute]) {
      assert.match(route, /applyActiveSignatureAndStampToTenderDocuments/);
    }
  });

  it("runs after letterhead in the same generation stage, so branding order is deterministic", () => {
    for (const route of [generateRoute, autoFinalizeRoute]) {
      const letterheadAt = route.indexOf("applyActiveUploadedLetterheadToTenderDocuments(");
      const signatureAt = route.indexOf("applyActiveSignatureAndStampToTenderDocuments(");
      assert.ok(letterheadAt > -1 && signatureAt > -1);
      assert.ok(signatureAt > letterheadAt, "signature/stamp must be applied after letterhead");
    }
  });
});

describe("the applier cannot invent a signature or escape the tender's own rules", () => {
  it("honours the tender's own prohibition on signatures/stamps/anonymous submission", () => {
    assert.match(applier, /detectBrandingPolicy\(tenderText\)/);
    assert.match(applier, /forbidsSig = !brandingPolicy\.signatureAllowed/);
    assert.match(applier, /forbidsStmp = !brandingPolicy\.stampAllowed/);
    // Both prohibited: return before touching a single document.
    assert.match(applier, /if \(forbidsSig && forbidsStmp\) \{[\s\S]*?return \{ signatureApplied: 0, stampApplied: 0 \};/);
  });

  it("honours the owner's global AppSettings switches", () => {
    assert.match(applier, /allowSignatureDefault/);
    assert.match(applier, /allowStampDefault/);
    assert.match(applier, /sigEnabled = company\?\.settings\?\.allowSignatureDefault !== false/);
    assert.match(applier, /stampEnabled = company\?\.settings\?\.allowStampDefault !== false/);
  });

  it("only ever uses an active, owner-uploaded asset with real image bytes — it never synthesises one", () => {
    assert.match(applier, /assetType: \{ in: \["SIGNATURE", "STAMP"\] \}/);
    assert.match(applier, /isActive: true/);
    assert.match(applier, /looksLikeImage\(sigBuffer\)/);
    assert.match(applier, /looksLikeImage\(stampBuffer\)/);
    // No asset uploaded => no-op, not a drawn or placeholder signature.
    assert.doesNotMatch(applier, /placeholder|drawSignature|generateSignature|syntheticSignature/i);
  });

  it("re-pins byte integrity and refuses to persist a document it corrupted", () => {
    assert.match(applier, /inspectActualFileBytes\(/);
    assert.match(applier, /if \(integrity\.integrityStatus !== "VERIFIED"\)[\s\S]*?continue;/);
  });

  it("is scoped to the requesting owner's own tender and company", () => {
    assert.match(applier, /prisma\.tender\.findFirst\(\{[\s\S]{0,80}where: \{ id: tenderId, userId \}/);
    assert.match(applier, /prisma\.company\.findUnique\(\{[\s\S]{0,40}where: \{ userId \}/);
  });
});
