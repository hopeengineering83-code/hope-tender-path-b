// Phase 19: Source trace integrity tests.
// Verifies that source page/quote tracing is present for all critical
// extracted fields — a core requirement from CLAUDE.md.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── 1. contactDetailsSource in AI prompt ──────────────────────────────────

describe("AI prompt contactDetailsSource field coverage", () => {
  const REQUIRED_SOURCE_FIELDS = [
    // Core contact fields
    "country",
    "clientAddress",
    "clientCity",
    "clientWebsite",
    "clientContactName",
    "clientContactTitle",
    "clientContactEmail",
    "clientContactPhone",
    "submissionAddress",
    "submissionEmailSubject",
    "preBidChannel",
    "preBidMeetingDate",
    "preBidMeetingLocation",
    "clientRepresentative",
    // Phase 18 entity-identity additions
    "procuringEntityName",
    "legalClientName",
    "donorAgency",
    "implementingAgency",
  ];

  const src = readFileSync("lib/ai.ts", "utf8");

  for (const field of REQUIRED_SOURCE_FIELDS) {
    it(`contactDetailsSource includes "${field}"`, () => {
      assert.ok(
        src.includes(`"${field}"`),
        `lib/ai.ts contactDetailsSource must include "${field}" for source traceability`,
      );
    });
  }

  it("contactDetailsSource type uses open Record<string, ...> to support future keys", () => {
    assert.ok(
      src.includes("Record<string, { page: number | null; quote: string | null }>"),
      "contactDetailsSource must use open Record type so new entity keys can be added",
    );
  });
});

// ── 2. Prisma schema stores contactDetailsSourceJson ─────────────────────

describe("Prisma schema source trace columns", () => {
  it("stores contactDetailsSourceJson as a String column", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    assert.ok(
      schema.includes("contactDetailsSourceJson"),
      "Prisma schema must have contactDetailsSourceJson column for source traceability",
    );
  });
});

// ── 3. MISSING_SOURCE marker never reaches export ─────────────────────────

describe("MISSING_SOURCE marker blocked at export gates", () => {
  it("PLACEHOLDER_PATTERNS includes MISSING_SOURCE", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(
      src.includes("MISSING_SOURCE"),
      "PLACEHOLDER_PATTERNS must include MISSING_SOURCE so untraced fields block export",
    );
  });

  it("authority-review detects MISSING_SOURCE via shared PLACEHOLDER_PATTERNS", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(
      src.includes("PLACEHOLDER_PATTERNS"),
      "authority-review must use PLACEHOLDER_PATTERNS (which includes MISSING_SOURCE)",
    );
  });

  it("validateDocumentQuality uses PLACEHOLDER_PATTERNS (which includes MISSING_SOURCE)", () => {
    const src = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    assert.ok(
      src.includes("PLACEHOLDER_PATTERNS"),
      "document-quality-validator must use shared PLACEHOLDER_PATTERNS",
    );
  });

  it("document with MISSING_SOURCE marker is blocked by validateDocumentQuality", () => {
    const { validateDocumentQuality } = require("../lib/engine/quality/document-quality-validator");
    const doc = {
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "Project overview follows. Client: MISSING_SOURCE — confirm manually. Submission address as per tender documents.",
      storagePath: null,
    };
    const result = validateDocumentQuality(doc);
    assert.equal(result.status, "BLOCKED", "MISSING_SOURCE in content must block document export");
    assert.ok(result.placeholders.length > 0, "MISSING_SOURCE must appear in placeholders list");
  });
});

// ── 4. Bid-Team stubs blocked end-to-end ──────────────────────────────────

describe("Bid-Team stub detection end-to-end", () => {
  it("PLACEHOLDER_PATTERNS includes Bid-Team to confirm", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(
      src.includes("Bid-Team"),
      "PLACEHOLDER_PATTERNS must include Bid-Team stubs",
    );
  });

  it("document with Bid-Team to confirm is blocked by validateDocumentQuality", () => {
    const { validateDocumentQuality } = require("../lib/engine/quality/document-quality-validator");
    const doc = {
      name: "Company Profile",
      documentType: "COMPANY_PROFILE",
      fileContent: "Company overview. Registration number: Bid-Team to confirm. Experience summary follows.",
      storagePath: null,
    };
    const result = validateDocumentQuality(doc);
    assert.equal(result.status, "BLOCKED", "Bid-Team stubs must block document export");
  });

  it("authority-review flags Bid-Team stubs via INTERNAL_NOTE_RE", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(
      src.includes("INTERNAL_NOTE_RE"),
      "authority-review must retain INTERNAL_NOTE_RE for Bid-Team stub detection",
    );
  });
});

// ── 5. Source-evidence action markers blocked ─────────────────────────────

describe("Source-evidence action marker detection", () => {
  it("PLACEHOLDER_PATTERNS includes Source-evidence action", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(
      src.includes("Source-evidence action"),
      "PLACEHOLDER_PATTERNS must include 'Source-evidence action' stub",
    );
  });

  it("document with Source-evidence action is blocked", () => {
    const { validateDocumentQuality } = require("../lib/engine/quality/document-quality-validator");
    const doc = {
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "Section A: Corporate profile. Source-evidence action required for registration. Capabilities follow.",
      storagePath: null,
    };
    const result = validateDocumentQuality(doc);
    assert.equal(result.status, "BLOCKED", "Source-evidence action markers must block export");
  });
});
