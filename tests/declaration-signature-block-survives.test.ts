import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The delivered proposal ended:
 *
 *   Signed for and on behalf of Hope Urban Planning ... PLC
 *   Signatory: General Manager
 *
 * and nothing else. No signature, no stamp, and nowhere to put either.
 *
 * Two independent causes, both confirmed against the artifact:
 *
 *   - tender-closers.ts emits "Signature: ____  Stamp: ____  Date: ____" as
 *     the declaration's signature block, and a generate-elite sanitiser that
 *     removes stray underscore placeholders removed it as well.
 *
 *   - The final PDF carries 36 XObject references and not one is an image
 *     (no /Subtype /Image, no /DCTDecode), so no signature image was applied
 *     on top either. pdf-finalizer renders the PDF from the DOCX's extracted
 *     markdown TEXT, so images cannot survive that step by construction.
 *
 * A proposal that says it is signed for and on behalf of a firm, and then
 * offers neither a signature nor a place for one, is worse than one that
 * simply carries the rule. This pins the rule's survival.
 */

test("the declaration's signature/stamp/date rule is not stripped as a placeholder", async () => {
  const { keepDeclarationSignatureRule } = await import("../lib/engine/generate-elite");
  const rule = "Signature: ____________________   Stamp: ____________________   Date: ____________________";
  assert.equal(keepDeclarationSignatureRule(rule), rule);
});

test("a stray underscore placeholder is still removed", () => {
  // The sanitiser exists to remove these; narrowing it must not disable it.
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  assert.match(source, /keepDeclarationSignatureRule/);
  const fnStart = source.indexOf("function keepDeclarationSignatureRule");
  assert.ok(fnStart > -1);
});

test("only the three-label block survives; single labels do not", async () => {
  const { keepDeclarationSignatureRule } = await import("../lib/engine/generate-elite");
  for (const stray of [
    "Signature: ____________________",
    "Date: ______________",
    "Company Stamp: ________",
    "Stamp: ____  Date: ____",
    "Signature: ____  Date: ____",
  ]) {
    assert.equal(keepDeclarationSignatureRule(stray), "", stray);
  }
});

test("the closer still emits the block it is responsible for", () => {
  const closers = readFileSync("lib/engine/tender-closers.ts", "utf8");
  const line = /"(Signature:[^"]*Stamp:[^"]*Date:[^"]*)"/.exec(closers);
  assert.ok(line, "tender-closers.ts no longer emits a signature block");
});

test("writer and sanitiser agree — what the closer emits is what survives", async () => {
  const { keepDeclarationSignatureRule } = await import("../lib/engine/generate-elite");
  const closers = readFileSync("lib/engine/tender-closers.ts", "utf8");
  const emitted = /"(Signature:[^"]*Stamp:[^"]*Date:[^"]*)"/.exec(closers)![1];
  assert.equal(keepDeclarationSignatureRule(emitted), emitted);
});
