import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { generateProposalPdf } from "../lib/engine/proposal-pdf";

/**
 * The delivered PDF carried 36 XObject references and not one image — no
 * /Subtype /Image, no /DCTDecode, no image codec of any kind — while the vault
 * held an ACTIVE, integrity-VERIFIED signature (3,246 bytes) and stamp
 * (103,155 bytes), and the document said "Signed for and on behalf of ...".
 *
 * apply-signature-stamp.ts embeds both into the generated DOCX correctly.
 * pdf-finalizer then renders the PDF from the DOCX's extracted markdown TEXT
 * rather than converting the DOCX bytes, so images cannot survive that step by
 * construction: no tender of any sector could deliver a signed or stamped PDF.
 *
 * The renderer now draws them itself, anchored to the declaration's own
 * signature rule.
 */

/** A minimal valid 1x1 JPEG, so the test proves embedding, not a fixture. */
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const DECLARATION = [
  "# Declaration",
  "",
  "**Signed for and on behalf of Example Consultancy PLC**",
  "",
  "Signatory: General Manager",
  "",
  "Signature: ____________________   Stamp: ____________________   Date: ____________________",
  "",
].join("\n");

function imageXObjectCount(pdf: Uint8Array): number {
  const bytes = Buffer.from(pdf).toString("latin1");
  return (bytes.match(/\/Subtype\s*\/Image/g) ?? []).length;
}

test("a proposal with no brand assets renders, and carries no images", async () => {
  const pdf = await generateProposalPdf({ title: "Technical Proposal", markdown: DECLARATION });
  assert.ok(pdf.byteLength > 0);
  assert.equal(imageXObjectCount(pdf), 0);
});

test("an authorised signature reaches the delivered PDF", async () => {
  const pdf = await generateProposalPdf({
    title: "Technical Proposal",
    markdown: DECLARATION,
    signature: { bytes: new Uint8Array(JPEG_1X1), mimeType: "image/jpeg" },
  });
  assert.equal(imageXObjectCount(pdf), 1);
});

test("signature and stamp both reach the delivered PDF", async () => {
  const pdf = await generateProposalPdf({
    title: "Technical Proposal",
    markdown: DECLARATION,
    signature: { bytes: new Uint8Array(JPEG_1X1), mimeType: "image/jpeg" },
    stamp: { bytes: new Uint8Array(JPEG_1X1), mimeType: "image/jpeg" },
  });
  assert.equal(imageXObjectCount(pdf), 2);
});

test("a corrupt asset costs the client nothing but the image", async () => {
  const pdf = await generateProposalPdf({
    title: "Technical Proposal",
    markdown: DECLARATION,
    signature: { bytes: new Uint8Array(Buffer.from("not an image at all")), mimeType: "image/jpeg" },
  });
  assert.ok(pdf.byteLength > 0, "the proposal must still be produced");
  assert.equal(imageXObjectCount(pdf), 0);
});

test("images are drawn only where a declaration signature rule exists", async () => {
  // A document with no declaration must not acquire a floating signature.
  const pdf = await generateProposalPdf({
    title: "Technical Proposal",
    markdown: "# Section A\n\nOrdinary body text with no declaration block.\n",
    signature: { bytes: new Uint8Array(JPEG_1X1), mimeType: "image/jpeg" },
    stamp: { bytes: new Uint8Array(JPEG_1X1), mimeType: "image/jpeg" },
  });
  assert.equal(imageXObjectCount(pdf), 0);
});

test("the finalizer honours the tender's branding policy and the company's settings", () => {
  // Tender requirements override brand preference — same authority as
  // apply-signature-stamp.ts, so a tender that forbids a stamp still gets none.
  const source = readFileSync("lib/engine/workflow/pdf-finalizer.ts", "utf8");
  assert.match(source, /detectBrandingPolicy/);
  assert.match(source, /policy\.signatureAllowed/);
  assert.match(source, /policy\.stampAllowed/);
  assert.match(source, /allowSignatureDefault/);
  assert.match(source, /allowStampDefault/);
  assert.match(source, /isActive: true/);
});
