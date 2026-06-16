// Phase 34 guard-fix regression tests.
//
// Coverage:
//   1. ai-analyze/route: imports isValidCountry, isValidReferenceNumber, containsMetadataPlaceholder
//   2. ai-analyze/route (streaming + non-streaming): all client/contact/location fields guarded
//   3. lib/ai.ts: CLIENT ENTITY RULE present in CRITICAL RULES
//   4. lib/ai.ts: PLACEHOLDER PROHIBITION present in CRITICAL RULES

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const aiAnalyzeSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
  "utf-8",
);

const aiLibSource = readFileSync(
  path.join(process.cwd(), "lib/ai.ts"),
  "utf-8",
);

// ── Import guards ─────────────────────────────────────────────────────────────

describe("ai-analyze/route — validator imports", () => {
  it("imports isValidCountry from metadata-validators", () => {
    assert.ok(
      aiAnalyzeSource.includes("isValidCountry"),
      "ai-analyze route must import isValidCountry",
    );
  });

  it("imports isValidReferenceNumber from metadata-validators", () => {
    assert.ok(
      aiAnalyzeSource.includes("isValidReferenceNumber"),
      "ai-analyze route must import isValidReferenceNumber",
    );
  });

  it("imports containsMetadataPlaceholder from metadata-validators", () => {
    assert.ok(
      aiAnalyzeSource.includes("containsMetadataPlaceholder"),
      "ai-analyze route must import containsMetadataPlaceholder",
    );
  });
});

// ── Field guards (streaming path) ────────────────────────────────────────────

describe("ai-analyze/route — streaming path field guards", () => {
  it("guards country write with isValidCountry", () => {
    assert.ok(
      aiAnalyzeSource.includes("isValidCountry(aiResult.country)"),
      "streaming path must guard country write with isValidCountry()",
    );
  });

  it("guards clientAddress write with containsMetadataPlaceholder", () => {
    assert.ok(
      aiAnalyzeSource.includes("containsMetadataPlaceholder(aiResult.clientAddress)"),
      "streaming path must guard clientAddress write with containsMetadataPlaceholder()",
    );
  });

  it("guards clientContactEmail write with containsMetadataPlaceholder", () => {
    assert.ok(
      aiAnalyzeSource.includes("containsMetadataPlaceholder(aiResult.clientContactEmail)"),
      "streaming path must guard clientContactEmail write with containsMetadataPlaceholder()",
    );
  });

  it("guards clientContactPhone write with containsMetadataPlaceholder", () => {
    assert.ok(
      aiAnalyzeSource.includes("containsMetadataPlaceholder(aiResult.clientContactPhone)"),
      "streaming path must guard clientContactPhone write with containsMetadataPlaceholder()",
    );
  });

  it("guards clientRepresentative write with containsMetadataPlaceholder", () => {
    assert.ok(
      aiAnalyzeSource.includes("containsMetadataPlaceholder(aiResult.clientRepresentative)"),
      "streaming path must guard clientRepresentative write with containsMetadataPlaceholder()",
    );
  });

  it("guards procurementReferenceNumber write with isValidReferenceNumber", () => {
    assert.ok(
      aiAnalyzeSource.includes("isValidReferenceNumber(aiResult.procurementReferenceNumber)"),
      "streaming path must guard procurementReferenceNumber write with isValidReferenceNumber()",
    );
  });
});

// ── Field guards (non-streaming path) ────────────────────────────────────────

describe("ai-analyze/route — non-streaming path field guards", () => {
  it("non-streaming path also guards clientContactName with isValidClientContact", () => {
    // Count occurrences — must appear in BOTH paths
    const occurrences = (aiAnalyzeSource.match(/isValidClientContact\(aiResult\.clientContactName\)/g) ?? []).length;
    assert.ok(
      occurrences >= 2,
      `isValidClientContact guard must appear in both streaming and non-streaming paths (found ${occurrences} occurrence(s))`,
    );
  });

  it("non-streaming path guards country with isValidCountry", () => {
    const occurrences = (aiAnalyzeSource.match(/isValidCountry\(aiResult\.country\)/g) ?? []).length;
    assert.ok(
      occurrences >= 2,
      `isValidCountry guard must appear in both streaming and non-streaming paths (found ${occurrences} occurrence(s))`,
    );
  });

  it("non-streaming path guards clientAddress with containsMetadataPlaceholder", () => {
    const occurrences = (aiAnalyzeSource.match(/containsMetadataPlaceholder\(aiResult\.clientAddress\)/g) ?? []).length;
    assert.ok(
      occurrences >= 2,
      `containsMetadataPlaceholder(clientAddress) guard must appear in both paths (found ${occurrences} occurrence(s))`,
    );
  });

  it("non-streaming path guards procurementReferenceNumber with isValidReferenceNumber", () => {
    const occurrences = (aiAnalyzeSource.match(/isValidReferenceNumber\(aiResult\.procurementReferenceNumber\)/g) ?? []).length;
    assert.ok(
      occurrences >= 2,
      `isValidReferenceNumber guard must appear in both streaming and non-streaming paths (found ${occurrences} occurrence(s))`,
    );
  });
});

// ── lib/ai.ts prompt rules ────────────────────────────────────────────────────

describe("lib/ai.ts — CLIENT ENTITY RULE in CRITICAL RULES", () => {
  it("CRITICAL RULES section contains CLIENT ENTITY RULE heading", () => {
    assert.ok(
      aiLibSource.includes("CLIENT ENTITY RULE"),
      "lib/ai.ts CRITICAL RULES must contain CLIENT ENTITY RULE instruction",
    );
  });

  it("CLIENT ENTITY RULE instructs to return null when role not identifiable", () => {
    assert.ok(
      aiLibSource.includes("return null") && aiLibSource.includes("CLIENT ENTITY RULE"),
      "CLIENT ENTITY RULE must instruct returning null when role is not identifiable",
    );
  });

  it("CLIENT ENTITY RULE defines procuringEntityName role", () => {
    assert.ok(
      aiLibSource.includes("procuringEntityName") && aiLibSource.includes("RECEIVES and evaluates bids"),
      "CLIENT ENTITY RULE must define procuringEntityName as the authority that receives bids",
    );
  });

  it("CLIENT ENTITY RULE defines donorAgency role with examples", () => {
    assert.ok(
      aiLibSource.includes("donorAgency") && aiLibSource.includes("funder"),
      "CLIENT ENTITY RULE must define donorAgency as the funder",
    );
  });
});

describe("lib/ai.ts — PLACEHOLDER PROHIBITION in CRITICAL RULES", () => {
  it("CRITICAL RULES section contains PLACEHOLDER PROHIBITION heading", () => {
    assert.ok(
      aiLibSource.includes("PLACEHOLDER PROHIBITION"),
      "lib/ai.ts CRITICAL RULES must contain PLACEHOLDER PROHIBITION instruction",
    );
  });

  it("PLACEHOLDER PROHIBITION explicitly bans 'Bid-Team to confirm'", () => {
    assert.ok(
      aiLibSource.includes("Bid-Team to confirm"),
      "PLACEHOLDER PROHIBITION must explicitly name 'Bid-Team to confirm' as banned",
    );
  });

  it("PLACEHOLDER PROHIBITION explicitly bans TBD, TBC, N/A", () => {
    assert.ok(
      aiLibSource.includes("TBD") && aiLibSource.includes("TBC") && aiLibSource.includes("N/A"),
      "PLACEHOLDER PROHIBITION must explicitly name TBD, TBC, and N/A as banned",
    );
  });

  it("PLACEHOLDER PROHIBITION instructs returning null for absent fields", () => {
    assert.ok(
      aiLibSource.includes("return null for that field"),
      "PLACEHOLDER PROHIBITION must instruct returning null when information is absent",
    );
  });
});

describe("lib/ai.ts — contactDetailsSource extraction key coverage (Gap: procurementReferenceNumber)", () => {
  it("contactDetailsSource extraction loop includes procurementReferenceNumber", () => {
    assert.ok(
      aiLibSource.includes('"procurementReferenceNumber"') &&
        (aiLibSource.match(/"procurementReferenceNumber"/g) ?? []).length >= 2,
      "lib/ai.ts must include procurementReferenceNumber in BOTH the AI prompt contactDetailsSource section AND the extraction key loop so reference-number source traceability is stored",
    );
  });

  it("contactDetailsSource extraction loop includes all 19 required client fields", () => {
    const requiredKeys = [
      "country", "clientAddress", "clientCity", "clientWebsite",
      "clientContactName", "clientContactTitle", "clientContactEmail", "clientContactPhone",
      "submissionAddress", "submissionEmailSubject", "preBidChannel",
      "preBidMeetingDate", "preBidMeetingLocation", "clientRepresentative",
      "procuringEntityName", "legalClientName", "donorAgency", "implementingAgency",
      "procurementReferenceNumber",
    ];
    // The extraction loop is a for..of over a literal array — all keys must appear
    // in lib/ai.ts at least twice (prompt + extraction loop).
    for (const key of requiredKeys) {
      const count = (aiLibSource.match(new RegExp(`"${key}"`, "g")) ?? []).length;
      assert.ok(count >= 2, `lib/ai.ts must contain "${key}" at least twice (prompt definition + extraction loop); found ${count}`);
    }
  });
});
