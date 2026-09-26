// P1: real APPLICATION artifact bytes — not generic library demos.
//
// tests/artifact-integrity-verification.test.ts asserts that package.json lists
// `docx`, that generate-elite.ts imports it, and that the handler mentions
// generateTenderDocuments. That is source inspection (evidence D). It states
// that physical verification "requires authenticated E2E access to Production",
// which is not true of the byte-producing layer: the application's own document
// builders are ordinary exported functions and can be executed directly.
//
// Proving a generic `docx`/`pdf-lib` round-trip proves those libraries work. It
// says nothing about whether THIS product emits a valid, branded, placeholder-
// free proposal. These tests execute the application's real producers and
// inspect the actual bytes they return:
//
//   • lib/engine/generate-elite.ts  → markdownToDocx + buildProfessionalDocument
//   • lib/engine/proposal-pdf.ts    → generateProposalPdf
//   • lib/engine/workflow/pdf-finalizer.ts → the product's own byte validators
//
// Evidence level C: real application code, real bytes, real structural parsing.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";

const TENDER_TITLE = "Supply and Installation of Medical Equipment";
const CLIENT_NAME = "Ministry of Health";
const COMPANY_NAME = "Hope Engineering PLC";
const REFERENCE = "MOH/ICB/2026/014";

const PROPOSAL_MARKDOWN = [
  "# Technical Proposal",
  "",
  "## 1. Understanding of the Assignment",
  `${COMPANY_NAME} has reviewed the requirements for ${TENDER_TITLE} issued by ${CLIENT_NAME}.`,
  "",
  "## 2. Methodology",
  "Our delivery approach covers installation, commissioning, training and warranty support.",
  "",
  "| Phase | Duration |",
  "| --- | --- |",
  "| Mobilisation | 2 weeks |",
  "| Installation | 8 weeks |",
  "",
  "## 3. Quality Assurance",
  "All works are delivered under an ISO 9001:2015 certified quality management system.",
].join("\n");

/** Patterns that must never survive into a deliverable proposal. */
const UNRESOLVED_PLACEHOLDER = /\{\{[^}]+\}\}|\[\[[^\]]+\]\]|\bTBD\b|\bTODO\b|\bFIXME\b|\bLOREM IPSUM\b|\bXXX+\b|<PLACEHOLDER>/i;

/** Traces that would reveal the system rather than the proposal. */
const AI_OR_INTERNAL_TRACE =
  /\b(?:as an AI language model|I cannot|I'm sorry, but|system prompt|assistant:|user:|openai|anthropic|gpt-4|claude-|gemini-|deepseek|cerebras|groq|mistral|openrouter)\b/i;

/** Secret-shaped material. */
const SECRET_SHAPED = /\b(?:sk-[A-Za-z0-9-_]{8,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{8,}|postgres(?:ql)?:\/\/|Bearer\s+[A-Za-z0-9._-]{12,})/;

async function buildRealDocxBytes(options: { suppressBrandedHeader?: boolean; suppressCoverBlock?: boolean } = {}) {
  const { markdownToDocx, buildProfessionalDocument } = await import("../lib/engine/generate-elite");
  const { Packer } = await import("docx");

  // The product's own markdown → DOCX element conversion, then the product's
  // own document assembly (headers, footers, branding, cover block).
  const children = markdownToDocx(PROPOSAL_MARKDOWN);
  const document = buildProfessionalDocument({
    tenderTitle: TENDER_TITLE,
    clientName: CLIENT_NAME,
    companyName: COMPANY_NAME,
    reference: REFERENCE,
    contactFooter: `${COMPANY_NAME} | Addis Ababa | info@example.test`,
    children,
    ...options,
  });

  return Buffer.from(await Packer.toBuffer(document));
}

/** Open a real OPC/ZIP container with the project's own ZIP library. */
async function openZip(bytes: Buffer | Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(Buffer.from(bytes));
}

async function entryText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  assert.ok(file, `archive is missing ${path}`);
  return file!.async("string");
}

/** Concatenated visible text of a DOCX, read from the real OPC part. */
async function docxVisibleText(zip: JSZip): Promise<string> {
  const xml = await entryText(zip, "word/document.xml");
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("P1: real application DOCX bytes", () => {
  it("the app's own builder emits a structurally valid OPC package", async () => {
    const bytes = await buildRealDocxBytes();

    assert.ok(bytes.length > 0, "DOCX must not be zero bytes");
    // OPC is a ZIP: the local file header magic must be present.
    assert.equal(bytes[0], 0x50, "DOCX must begin with the ZIP magic 'PK'");
    assert.equal(bytes[1], 0x4b, "DOCX must begin with the ZIP magic 'PK'");

    // A real parser must be able to open it — not merely a signature check.
    const zip = await openZip(bytes);
    for (const required of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
      assert.ok(zip.file(required), `DOCX is missing the required OPC part ${required}`);
    }
    assert.ok((await entryText(zip, "word/document.xml")).length > 0, "word/document.xml must not be empty");
  });

  it("carries the actual tender and company content", async () => {
    const text = await docxVisibleText(await openZip(await buildRealDocxBytes()));

    // A valid-but-empty document would pass every structural check above.
    for (const expected of [TENDER_TITLE, CLIENT_NAME, COMPANY_NAME, "Methodology", "Quality Assurance"]) {
      assert.ok(text.includes(expected), `DOCX body must contain ${JSON.stringify(expected)}`);
    }
  });

  it("renders markdown tables as real DOCX tables, not literal pipe characters", async () => {
    const zip = await openZip(await buildRealDocxBytes());
    const xml = await entryText(zip, "word/document.xml");

    assert.match(xml, /<w:tbl[>\s]/, "markdown tables must become real DOCX table elements");
    assert.ok(
      (await docxVisibleText(zip)).includes("Mobilisation"),
      "table cell content must survive into the document",
    );
  });

  it("contains no unresolved placeholder, AI trace, or secret", async () => {
    const text = await docxVisibleText(await openZip(await buildRealDocxBytes()));

    const placeholder = text.match(UNRESOLVED_PLACEHOLDER);
    assert.equal(placeholder, null, `DOCX contains an unresolved placeholder: ${placeholder?.[0]}`);

    const trace = text.match(AI_OR_INTERNAL_TRACE);
    assert.equal(trace, null, `DOCX leaks an AI/provider trace: ${trace?.[0]}`);

    const secret = text.match(SECRET_SHAPED);
    assert.equal(secret, null, `DOCX leaks secret-shaped material: ${secret?.[0]}`);
  });

  it("leaks no internal identifiers, stack traces, or database text", async () => {
    const { internalArtifactIssues } = await import("../lib/engine/workflow/pdf-finalizer");
    const text = await docxVisibleText(await openZip(await buildRealDocxBytes()));

    // The product's own detector, applied to the product's own bytes.
    assert.deepEqual(internalArtifactIssues(text), [], "DOCX must contain no internal artifact text");
  });

  it("honours the tender's branding restriction in the emitted bytes", async () => {
    // Compliance rule: when a tender forbids branding, the company name must
    // not appear in the header. Proven from the rendered header part, not from
    // the flag being passed.
    const readHeaders = async (bytes: Buffer): Promise<string> => {
      const zip = await openZip(bytes);
      const names = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n));
      const parts = await Promise.all(names.map((n) => entryText(zip, n)));
      return parts.join(" ");
    };

    const brandedHeaders = await readHeaders(await buildRealDocxBytes());
    const suppressedHeaders = await readHeaders(await buildRealDocxBytes({ suppressBrandedHeader: true }));

    assert.ok(brandedHeaders.includes(COMPANY_NAME), "the default header must carry company branding");
    assert.ok(
      !suppressedHeaders.includes(COMPANY_NAME),
      "a branding-restricted tender must not emit the company name in the header",
    );
  });
});

describe("P1: real application PDF bytes", () => {
  it("the app's own PDF generator emits a parseable, non-empty PDF", async () => {
    const { generateProposalPdf } = await import("../lib/engine/proposal-pdf");

    const bytes = await generateProposalPdf({
      title: TENDER_TITLE,
      clientName: CLIENT_NAME,
      reference: REFERENCE,
      markdown: PROPOSAL_MARKDOWN,
      companyName: COMPANY_NAME,
      companyContact: "info@example.test",
    });

    assert.ok(bytes.length > 0, "PDF must not be zero bytes");
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-", "PDF must carry the %PDF- header");

    // A real parser must open it and report at least one page.
    const { PDFDocument } = await import("pdf-lib");
    const parsed = await PDFDocument.load(bytes);
    assert.ok(parsed.getPageCount() > 0, "PDF must contain at least one page");
  });

  it("passes the product's own PDF byte validator", async () => {
    const { generateProposalPdf } = await import("../lib/engine/proposal-pdf");
    const { validatePdfBytes } = await import("../lib/engine/workflow/pdf-finalizer");

    const bytes = await generateProposalPdf({
      title: TENDER_TITLE,
      clientName: CLIENT_NAME,
      markdown: PROPOSAL_MARKDOWN,
      companyName: COMPANY_NAME,
    });

    const verdict = validatePdfBytes(bytes);
    assert.equal(verdict.ok, true, `product PDF validator rejected the product's own PDF: ${JSON.stringify(verdict)}`);
  });

  it("a generation failure fails the test rather than being swallowed", async () => {
    const { generateProposalPdf } = await import("../lib/engine/proposal-pdf");

    // Guards against the anti-pattern of catching a generation error and
    // passing because a PDF library merely exists.
    const bytes = await generateProposalPdf({
      title: TENDER_TITLE,
      markdown: "# Minimal\n\nSingle short section.",
      companyName: COMPANY_NAME,
    });
    assert.ok(bytes.length > 100, "even a minimal proposal must produce real PDF content");
  });
});

describe("P1: real ZIP container integrity", () => {
  it("the assembled package opens with a real parser and every entry is non-empty", async () => {
    const crypto = await import("node:crypto");

    // Build the package from the application's REAL artifact bytes, then apply
    // the manifest/integrity contract the final ZIP gate depends on.
    const docx = await buildRealDocxBytes();
    const { generateProposalPdf } = await import("../lib/engine/proposal-pdf");
    const pdf = Buffer.from(
      await generateProposalPdf({ title: TENDER_TITLE, markdown: PROPOSAL_MARKDOWN, companyName: COMPANY_NAME }),
    );

    const files: Record<string, Buffer> = {
      "01-Technical-Proposal.docx": docx,
      "02-Technical-Proposal.pdf": pdf,
    };
    const manifest = {
      generatedAt: new Date().toISOString(),
      entries: Object.entries(files).map(([name, data]) => ({
        name,
        bytes: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"),
      })),
    };

    const builder = new JSZip();
    for (const [name, data] of Object.entries(files)) builder.file(name, data);
    builder.file("manifest.json", JSON.stringify(manifest, null, 2));
    const zipBytes = await builder.generateAsync({ type: "nodebuffer" });

    const opened = await openZip(zipBytes);
    assert.ok(opened.file("manifest.json"), "the package must carry a manifest");

    for (const name of Object.keys(opened.files)) {
      const data = await opened.file(name)!.async("nodebuffer");
      assert.ok(data.length > 0, `packaged entry ${name} must not be zero bytes`);
    }

    // The manifest SHA must match the ACTUAL packaged bytes — the property a
    // corrupted or substituted artifact would break.
    const parsedManifest = JSON.parse(await entryText(opened, "manifest.json")) as typeof manifest;
    for (const entry of parsedManifest.entries) {
      const packagedFile = opened.file(entry.name);
      assert.ok(packagedFile, `manifest lists ${entry.name} but it is not in the archive`);
      const packaged = await packagedFile!.async("nodebuffer");
      const actual = crypto.createHash("sha256").update(packaged).digest("hex");
      assert.equal(actual, entry.sha256, `manifest SHA-256 for ${entry.name} does not match the packaged bytes`);
      assert.equal(packaged.length, entry.bytes, `manifest byte length for ${entry.name} is wrong`);
    }

    // Every packaged artifact must still be individually valid after packaging.
    const repackedDocx = await opened.file("01-Technical-Proposal.docx")!.async("nodebuffer");
    assert.ok((await openZip(repackedDocx)).file("word/document.xml"), "the packaged DOCX must still be a valid OPC package");
    const repackedPdf = await opened.file("02-Technical-Proposal.pdf")!.async("nodebuffer");
    assert.equal(
      repackedPdf.subarray(0, 5).toString("latin1"),
      "%PDF-",
      "the packaged PDF must still carry its header",
    );
  });
});
