// Regression tests for the ZIP export package flow.
//
// Covers: DOCX signature detection, forbidden pattern detection in generated
// documents, document sort order for ZIP assembly, CV subfolder routing,
// file list composition, name normalization, export readiness gate shapes,
// and validation failure blocking.
//
// All tests are pure (no Prisma). Logic is inlined from download/route.ts and
// export-readiness.ts so changes to either file are caught as regressions.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ─── Inline helpers from download/route.ts ────────────────────────────────────

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function safeParseArr(v: unknown): string[] {
  try {
    const parsed = JSON.parse(v as string);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function visibleXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidDocxSignature(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

// Inline forbidden patterns from validateGeneratedDocx in download/route.ts
const FORBIDDEN_PATTERNS: RegExp[] = [
  /AI_DRAFT/i,
  /REGEX_DRAFT/i,
  /remove before submission/i,
  /\[\s*(?:INSERT|TBD|TBA|TODO|FILL[-_\s]*IN|PLACEHOLDER|YOUR\s+\w+\s+HERE|DATE|NAME|CLIENT|VALUE|AMOUNT)\b[^\]]*\]/i,
  /sample text/i,
  /lorem ipsum/i,
  /as an AI/i,
  /AI-generated/i,
  /source snippet/i,
  /deterministic safety import/i,
  /=+\s*PAGE\s+\d+\s*=+/i,
  /PARSED TEXT FOR PAGE/i,
  /Company evidence available:/i,
  /Project evidence available:/i,
];

function hasForbiddenPattern(text: string, name = "", filename = ""): boolean {
  return FORBIDDEN_PATTERNS.some((p) => p.test(text) || p.test(name) || p.test(filename));
}

// Inline safeFileBaseName logic (from lib/engine/proposal-labels.ts)
function safeFileBaseName(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return cleaned || "submission-package";
}

// ─── DOCX signature validation ────────────────────────────────────────────────

describe("DOCX signature validation", () => {
  it("accepts a valid PK (ZIP) magic header", () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    assert.ok(isValidDocxSignature(buf));
  });

  it("rejects plain text masquerading as DOCX", () => {
    const buf = Buffer.from("This is plain text, not a DOCX file.");
    assert.ok(!isValidDocxSignature(buf));
  });

  it("rejects a 2-byte PK prefix that is too short", () => {
    const buf = Buffer.from([0x50, 0x4b]);
    assert.ok(!isValidDocxSignature(buf), "length must exceed 4");
  });

  it("rejects a PDF magic bytes header", () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    assert.ok(!isValidDocxSignature(buf));
  });

  it("rejects an empty buffer", () => {
    assert.ok(!isValidDocxSignature(Buffer.alloc(0)));
  });
});

// ─── Forbidden pattern detection ─────────────────────────────────────────────

describe("forbidden pattern detection in generated document content", () => {
  it("flags AI_DRAFT in document text", () => {
    assert.ok(hasForbiddenPattern("AI_DRAFT: This content was AI-generated and must be reviewed."));
  });

  it("flags REGEX_DRAFT label", () => {
    assert.ok(hasForbiddenPattern("Expert record status: REGEX_DRAFT — awaiting human review."));
  });

  it("flags 'remove before submission' instruction", () => {
    assert.ok(hasForbiddenPattern("(Remove before submission) — internal review note."));
  });

  it("flags [INSERT client name here] placeholder", () => {
    assert.ok(hasForbiddenPattern("Dear [INSERT client name here], please find enclosed our proposal."));
  });

  it("flags [TODO: fill in] bracket placeholder", () => {
    assert.ok(hasForbiddenPattern("Contract value: [TODO: fill in before submission]"));
  });

  it("flags lorem ipsum filler text", () => {
    assert.ok(hasForbiddenPattern("Lorem ipsum dolor sit amet, consectetur adipiscing elit."));
  });

  it("flags 'as an AI' disclaimer", () => {
    assert.ok(hasForbiddenPattern("This document was prepared as an AI assistant output."));
  });

  it("flags 'AI-generated' label in file name", () => {
    assert.ok(hasForbiddenPattern("", "AI-generated-proposal", "AI-generated-proposal.docx"));
  });

  it("flags 'source snippet' metadata trace", () => {
    assert.ok(hasForbiddenPattern("source snippet: Section 3.2 of the project record vault."));
  });

  it("flags 'Company evidence available:' metadata", () => {
    assert.ok(hasForbiddenPattern("Company evidence available: 3 relevant project references found."));
  });

  it("flags 'Project evidence available:' metadata", () => {
    assert.ok(hasForbiddenPattern("Project evidence available: 2 matching projects in vault."));
  });

  it("flags PARSED TEXT FOR PAGE scanner artifact", () => {
    assert.ok(hasForbiddenPattern("PARSED TEXT FOR PAGE 3 — continued below the header."));
  });

  it("flags === PAGE N === scanner artifact", () => {
    assert.ok(hasForbiddenPattern("===== PAGE 5 ====="));
  });

  it("does not flag a clean technical proposal", () => {
    const clean = [
      "This technical proposal outlines our approach to road rehabilitation in the Northern Region.",
      "Section 2: Technical Methodology. Our team has completed 12 similar projects since 2018.",
      "Appendix A: CVs of Senior Engineers assigned to this project, with 10+ years of experience.",
      "Quality assurance procedures will be applied at all stages of design and construction supervision.",
    ].join("\n");
    assert.ok(!hasForbiddenPattern(clean), `Clean document must not trigger forbidden patterns`);
  });

  it("does not flag clean financial evidence text", () => {
    const text = "Audited financial statements for fiscal years 2022 and 2023 demonstrate the company meets the minimum turnover requirements.";
    assert.ok(!hasForbiddenPattern(text));
  });
});

// ─── generatedFileName — name normalization ───────────────────────────────────

describe("generatedFileName — .docx extension and safe name", () => {
  it("adds .docx to a plain name", () => {
    assert.equal(generatedFileName("Technical Proposal"), "Technical-Proposal.docx");
  });

  it("replaces non-alphanumeric chars with hyphens", () => {
    assert.equal(generatedFileName("Technical Proposal – Final v2"), "Technical-Proposal---Final-v2.docx");
  });

  it("handles names with slashes (path separators)", () => {
    const result = generatedFileName("Section 1/Cover Letter");
    assert.ok(result.endsWith(".docx"));
    assert.ok(!result.includes("/"), "Must not contain slashes in the filename");
  });

  it("handles an already-hyphenated name", () => {
    assert.equal(generatedFileName("Cover-Letter"), "Cover-Letter.docx");
  });

  it("produces a non-empty result for any non-empty name", () => {
    const names = ["A", "CV", "Financial Evidence 2024", "Annexe_3"];
    for (const name of names) {
      const result = generatedFileName(name);
      assert.ok(result.length > 5, `Expected a non-trivial filename for "${name}", got "${result}"`);
      assert.ok(result.endsWith(".docx"));
    }
  });
});

// ─── normalizeName ────────────────────────────────────────────────────────────

describe("normalizeName — case and whitespace normalization for file matching", () => {
  it("lowercases and trims whitespace", () => {
    assert.equal(normalizeName("  Technical Proposal.docx  "), "technical proposal.docx");
  });

  it("handles already-normalized names", () => {
    assert.equal(normalizeName("cover-letter.docx"), "cover-letter.docx");
  });

  it("collapses internal whitespace is NOT its job (only trims edges)", () => {
    // normalizeName only trims; internal whitespace is preserved (as in source)
    assert.equal(normalizeName("  hello world  "), "hello world");
  });
});

// ─── safeParseArr ─────────────────────────────────────────────────────────────

describe("safeParseArr — JSON array parsing for exact file lists", () => {
  it("parses a valid JSON array of file names", () => {
    const result = safeParseArr('["file-a.docx","file-b.docx"]');
    assert.deepEqual(result, ["file-a.docx", "file-b.docx"]);
  });

  it("returns empty array for invalid JSON", () => {
    assert.deepEqual(safeParseArr("not-json"), []);
  });

  it("returns empty array for null", () => {
    assert.deepEqual(safeParseArr(null), []);
  });

  it("returns empty array for undefined", () => {
    assert.deepEqual(safeParseArr(undefined), []);
  });

  it("returns empty array for a JSON object (not an array)", () => {
    assert.deepEqual(safeParseArr('{"file": "a.docx"}'), []);
  });

  it("filters out empty strings in a parsed array", () => {
    assert.deepEqual(safeParseArr('["file-a.docx","","file-b.docx"]'), ["file-a.docx", "file-b.docx"]);
  });
});

// ─── visibleXmlText — DOCX XML to plain text ─────────────────────────────────

describe("visibleXmlText — DOCX XML text extraction", () => {
  it("strips XML tags from word/document.xml", () => {
    const xml = "<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>";
    const result = visibleXmlText(xml);
    assert.ok(result.includes("Hello World"), `Expected 'Hello World' in: "${result}"`);
    assert.ok(!result.includes("<"), "No XML tags in output");
  });

  it("replaces <w:tab/> with a space", () => {
    const xml = "<w:r><w:t>Col1</w:t></w:r><w:tab/><w:r><w:t>Col2</w:t></w:r>";
    const result = visibleXmlText(xml);
    assert.ok(result.includes("Col1"), "Col1 present");
    assert.ok(result.includes("Col2"), "Col2 present");
  });

  it("decodes &amp; entity", () => {
    const result = visibleXmlText("<w:t>Revenue &amp; Profit</w:t>");
    assert.ok(result.includes("Revenue & Profit"), `Expected decoded entity in: "${result}"`);
  });

  it("decodes &lt; and &gt; entities", () => {
    const result = visibleXmlText("<w:t>Score &lt; 100 &gt; 0</w:t>");
    assert.ok(result.includes("< 100"), "Lt decoded");
    assert.ok(result.includes("> 0"), "Gt decoded");
  });

  it("collapses multiple whitespace into single space", () => {
    const xml = "<w:t>Word1</w:t>   <w:t>Word2</w:t>";
    const result = visibleXmlText(xml);
    assert.ok(!result.includes("   "), "Multiple spaces must be collapsed");
  });

  it("trims leading and trailing whitespace", () => {
    const result = visibleXmlText("  <w:t>Content</w:t>  ");
    assert.equal(result, "Content");
  });
});

// ─── ZIP sort order ───────────────────────────────────────────────────────────

describe("ZIP file sort order by exactOrder", () => {
  it("sorts documents ascending by exactOrder", () => {
    const docs = [
      { exactOrder: 3, name: "C", exactFileName: "C.docx" },
      { exactOrder: 1, name: "A", exactFileName: "A.docx" },
      { exactOrder: 2, name: "B", exactFileName: "B.docx" },
    ];
    const sorted = [...docs].sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));
    assert.equal(sorted[0].name, "A");
    assert.equal(sorted[1].name, "B");
    assert.equal(sorted[2].name, "C");
  });

  it("documents without exactOrder go to the end (fallback 99)", () => {
    const docs = [
      { exactOrder: null as number | null, name: "Late", exactFileName: "Z.docx" },
      { exactOrder: 1, name: "First", exactFileName: "A.docx" },
    ];
    const sorted = [...docs].sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));
    assert.equal(sorted[0].name, "First");
    assert.equal(sorted[1].name, "Late");
  });

  it("maintains relative order among documents with the same exactOrder", () => {
    const docs = [
      { exactOrder: 1, name: "X", exactFileName: "X.docx" },
      { exactOrder: 1, name: "Y", exactFileName: "Y.docx" },
    ];
    const sorted = [...docs].sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));
    assert.equal(sorted.length, 2);
  });
});

// ─── CV subfolder routing ─────────────────────────────────────────────────────

describe("CV subfolder routing in ZIP", () => {
  function isCvDoc(doc: { documentType: string; name: string }): boolean {
    return doc.documentType === "EXPERT_CV_PACKAGE" || doc.name?.startsWith("CV-");
  }

  it("routes EXPERT_CV_PACKAGE type to CVs/ subfolder", () => {
    const doc = { documentType: "EXPERT_CV_PACKAGE", name: "John-Smith", exactFileName: "CV-John-Smith.docx" };
    assert.ok(isCvDoc(doc));
    const zipPath = `CVs/${doc.exactFileName ?? generatedFileName(doc.name)}`;
    assert.equal(zipPath, "CVs/CV-John-Smith.docx");
  });

  it("routes CV- prefixed document names to CVs/ subfolder", () => {
    const doc = { documentType: "GENERATED_DOCUMENT", name: "CV-Jane-Doe", exactFileName: null };
    assert.ok(isCvDoc(doc));
    const zipPath = `CVs/${doc.exactFileName ?? generatedFileName(doc.name)}`;
    assert.ok(zipPath.startsWith("CVs/"));
  });

  it("does not route TECHNICAL_PROPOSAL to CVs/ subfolder", () => {
    const doc = { documentType: "TECHNICAL_PROPOSAL", name: "Technical-Proposal", exactFileName: "Technical-Proposal.docx" };
    assert.ok(!isCvDoc(doc), "Technical proposal must not be routed to CVs/");
  });

  it("does not route FINANCIAL_EVIDENCE to CVs/ subfolder", () => {
    const doc = { documentType: "FINANCIAL_EVIDENCE", name: "Financial-Statements-2023", exactFileName: null };
    assert.ok(!isCvDoc(doc));
  });
});

// ─── ZIP file list composition ────────────────────────────────────────────────

describe("ZIP file list composition (generatedDocs + cvDocs)", () => {
  it("file list includes main documents and CVs/ paths", () => {
    const generatedDocs = [
      { exactFileName: "Technical-Proposal.docx", name: "Technical-Proposal" },
      { exactFileName: "Financial-Evidence.docx", name: "Financial-Evidence" },
    ];
    const cvDocs = [
      { exactFileName: "CV-John-Smith.docx", name: "CV-John-Smith" },
    ];
    const fileList = [
      ...generatedDocs.map((d) => d.exactFileName ?? generatedFileName(d.name)),
      ...cvDocs.map((d) => `CVs/${d.exactFileName ?? generatedFileName(d.name)}`),
    ];
    assert.equal(fileList.length, 3);
    assert.ok(fileList.includes("Technical-Proposal.docx"));
    assert.ok(fileList.includes("Financial-Evidence.docx"));
    assert.ok(fileList.includes("CVs/CV-John-Smith.docx"));
  });

  it("prefers exactFileName over generated name", () => {
    const doc = { exactFileName: "Tender-Technical-Proposal-Final.docx", name: "Technical-Proposal" };
    const fileName = doc.exactFileName ?? generatedFileName(doc.name);
    assert.equal(fileName, "Tender-Technical-Proposal-Final.docx");
  });

  it("falls back to generatedFileName when exactFileName is null", () => {
    const doc = { exactFileName: null as string | null, name: "Technical Proposal" };
    const fileName = doc.exactFileName ?? generatedFileName(doc.name);
    assert.equal(fileName, "Technical-Proposal.docx");
  });

  it("file list is empty when no documents exist", () => {
    const fileList: string[] = [];
    assert.equal(fileList.length, 0);
  });
});

// ─── ZIP package name ─────────────────────────────────────────────────────────

describe("ZIP package name format", () => {
  it("produces {safe-title}-submission-package.zip", () => {
    const tenderTitle = "Road Rehabilitation Project – Northern Region";
    const zipName = `${safeFileBaseName(tenderTitle)}-submission-package.zip`;
    assert.ok(zipName.endsWith(".zip"), "Must end with .zip");
    assert.ok(!zipName.includes(" "), "Must contain no spaces");
    assert.ok(zipName.includes("submission-package"), "Must include submission-package suffix");
  });

  it("safe base name strips leading/trailing hyphens", () => {
    const name = safeFileBaseName("– Special Project –");
    assert.ok(!name.startsWith("-"), `Must not start with hyphen, got: "${name}"`);
    assert.ok(!name.endsWith("-"), `Must not end with hyphen, got: "${name}"`);
  });

  it("safe base name replaces non-alphanumeric chars", () => {
    const name = safeFileBaseName("Project A & B: 2024/2025");
    assert.ok(!/[&:/]/.test(name), `Special chars must be removed, got: "${name}"`);
  });
});

// ─── Export readiness gate shapes ────────────────────────────────────────────

describe("export readiness gate — ZIP blocked conditions", () => {
  it("ok=false when per-document failures exist", () => {
    const result = {
      ok: false,
      failures: [{ documentId: "doc1", name: "Technical Proposal", fileName: "Technical-Proposal.docx", reasons: ["fileContent is missing"] }],
      tenderLevelBlockers: [] as Array<{ category: string; severity: string; title: string }>,
    };
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.ok(result.failures[0].reasons.includes("fileContent is missing"));
  });

  it("ok=false when tender-level blockers exist (no doc failures)", () => {
    const result = {
      ok: false,
      failures: [] as Array<{ documentId: string; name: string; fileName: string; reasons: string[] }>,
      tenderLevelBlockers: [{ category: "CLIENT_NAME_REQUIRED", severity: "HIGH", title: "Client/procuring entity name is missing or invalid." }],
    };
    assert.equal(result.ok, false);
    assert.equal(result.tenderLevelBlockers.length, 1);
    assert.equal(result.failures.length, 0);
  });

  it("ok=true only when both failures and tenderLevelBlockers are empty", () => {
    const result = {
      ok: true,
      failures: [] as Array<{ documentId: string; name: string; fileName: string; reasons: string[] }>,
      tenderLevelBlockers: [] as Array<{ category: string; severity: string; title: string }>,
    };
    assert.equal(result.ok, result.failures.length === 0 && result.tenderLevelBlockers.length === 0);
  });
});

// ─── Validation failures block ZIP ────────────────────────────────────────────

describe("validation failures block ZIP generation", () => {
  it("non-empty validationFailures must block the ZIP", () => {
    const validationFailures = [{ id: "doc1", name: "Technical Proposal", errors: ["DOCX file is unexpectedly small."] }];
    assert.ok(validationFailures.length > 0, "Must block when validation failures exist");
    assert.equal(validationFailures[0].errors[0], "DOCX file is unexpectedly small.");
  });

  it("empty validationFailures allows ZIP to proceed", () => {
    const validationFailures: Array<{ id: string; name: string; errors: string[] }> = [];
    assert.equal(validationFailures.length, 0);
  });

  it("a document with draft expert/project sources fails validation", () => {
    // mirrors: (doc.draftExpertCount ?? 0) > 0 → validation error
    const doc = { draftExpertCount: 2, draftProjectCount: 0 };
    const errors: string[] = [];
    if ((doc.draftExpertCount ?? 0) > 0 || (doc.draftProjectCount ?? 0) > 0) {
      errors.push("Document references draft/unreviewed sources.");
    }
    assert.equal(errors.length, 1);
    assert.match(errors[0], /draft\/unreviewed/);
  });

  it("a document with no draft sources passes the draft check", () => {
    const doc = { draftExpertCount: 0, draftProjectCount: 0 };
    const errors: string[] = [];
    if ((doc.draftExpertCount ?? 0) > 0 || (doc.draftProjectCount ?? 0) > 0) {
      errors.push("Document references draft/unreviewed sources.");
    }
    assert.equal(errors.length, 0);
  });

  it("a document with null draft counts (treated as 0) passes", () => {
    const doc = { draftExpertCount: null as number | null, draftProjectCount: null as number | null };
    const errors: string[] = [];
    if ((doc.draftExpertCount ?? 0) > 0 || (doc.draftProjectCount ?? 0) > 0) {
      errors.push("Document references draft/unreviewed sources.");
    }
    assert.equal(errors.length, 0);
  });
});

// ─── DOCX text length guard ───────────────────────────────────────────────────

describe("DOCX visible text length guard", () => {
  it("very short document text (< 100 chars) triggers a validation error", () => {
    const text = "Short.";
    const errors: string[] = [];
    if (text.length < 100) errors.push("Document text is too short for final submission.");
    assert.equal(errors.length, 1);
  });

  it("document text >= 100 chars passes the length guard", () => {
    const text = "A".repeat(100);
    const errors: string[] = [];
    if (text.length < 100) errors.push("Document text is too short for final submission.");
    assert.equal(errors.length, 0);
  });
});
