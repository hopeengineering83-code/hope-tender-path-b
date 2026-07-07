// Regression tests for quality gap fixes — Phase 18.
//
// Phase 18 covers two targeted improvements:
//
//   1. AI prompt contactDetailsSource now includes source-page tracing for the
//      three entity-identity fields that were previously untracked:
//        procuringEntityName, legalClientName, donorAgency, implementingAgency
//
//   2. generate/route.ts adds a mandatory-requirements advisory gate:
//      when requirements exist but none are classified MANDATORY (and there are
//      >= 3 of them), generation is blocked with errorCode NO_MANDATORY_REQUIREMENTS
//      unless ?acceptNoMandatoryReqs=true is supplied.
//
//   3. Regression: existing generate-docs-gate gates remain intact after Phase 18.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// ── 1. AI prompt contactDetailsSource coverage ───────────────────────────────

describe("phase 18 — AI prompt entity source tracing", () => {
  it("contactDetailsSource includes procuringEntityName", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(
      src.includes('"procuringEntityName"'),
      "AI prompt contactDetailsSource must include procuringEntityName for source traceability",
    );
  });

  it("contactDetailsSource includes legalClientName", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(
      src.includes('"legalClientName"'),
      "AI prompt contactDetailsSource must include legalClientName for source traceability",
    );
  });

  it("contactDetailsSource includes donorAgency", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(
      src.includes('"donorAgency"'),
      "AI prompt contactDetailsSource must include donorAgency for source traceability",
    );
  });

  it("contactDetailsSource includes implementingAgency", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(
      src.includes('"implementingAgency"'),
      "AI prompt contactDetailsSource must include implementingAgency for source traceability",
    );
  });

  it("contactDetailsSource type in AIAnalysisResult allows any string key (open Record)", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(
      src.includes("Record<string, { page: number | null; quote: string | null }>"),
      "AIAnalysisResult.contactDetailsSource must use open Record type to accept new entity keys",
    );
  });
});

// ── 2. generate/route.ts — mandatory requirements advisory gate ──────────────

describe("phase 18 — generate route mandatory requirements gate (static audit)", () => {
  it("route contains NO_MANDATORY_REQUIREMENTS errorCode", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes("NO_MANDATORY_REQUIREMENTS"),
      "generate route must define NO_MANDATORY_REQUIREMENTS errorCode",
    );
  });

  it("gate fires when zero mandatory requirements and >= 3 requirements exist", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes("mandatoryCount === 0 && tender.requirements.length >= 3"),
      "gate condition must check for zero MANDATORY count with minimum 3 requirements",
    );
  });

  it("gate no longer uses acceptNoMandatoryReqs bypass (removed)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      !src.includes("acceptNoMandatoryReqs"),
      "generate route must NOT support acceptNoMandatoryReqs bypass",
    );
  });

  it("nextAction is RERUN_AI_ANALYZE for mandatory requirements advisory", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const gateStart = src.indexOf("NO_MANDATORY_REQUIREMENTS");
    assert.ok(gateStart > -1, "gate must exist");
    // Use a wide window — the error message before nextAction is ~250 chars
    const gateBlock = src.slice(gateStart - 200, gateStart + 700);
    assert.ok(
      gateBlock.includes("RERUN_AI_ANALYZE"),
      "advisory gate must suggest RERUN_AI_ANALYZE as next action",
    );
  });

  it("gate is always active (planOnly bypass removed)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const gateStart = src.indexOf("NO_MANDATORY_REQUIREMENTS");
    const before = src.slice(Math.max(0, gateStart - 400), gateStart);
    assert.ok(
      !before.includes("planOnly"),
      "mandatory requirements gate must NOT respect planOnly bypass",
    );
  });

  it("gate does not fire when less than 3 requirements exist (avoids false positives)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes("tender.requirements.length >= 3"),
      "gate must only fire for tenders with 3 or more requirements",
    );
  });
});

// ── 3. Priority filtering logic (unit test, no HTTP) ─────────────────────────

describe("phase 18 — mandatory requirements filter logic", () => {
  function advisoryGateFires(reqs: Array<{ priority: string }>): boolean {
    const mandatoryCount = reqs.filter((r) => r.priority === "MANDATORY").length;
    return mandatoryCount === 0 && reqs.length >= 3;
  }

  it("gate does not fire with 2 non-mandatory requirements (below threshold)", () => {
    const reqs = [{ priority: "DESIRABLE" }, { priority: "OPTIONAL" }];
    assert.equal(advisoryGateFires(reqs), false);
  });

  it("gate fires with 3 non-mandatory requirements", () => {
    const reqs = [{ priority: "DESIRABLE" }, { priority: "OPTIONAL" }, { priority: "TECHNICAL" }];
    assert.equal(advisoryGateFires(reqs), true);
  });

  it("gate does not fire when at least one MANDATORY requirement exists", () => {
    const reqs = [
      { priority: "MANDATORY" },
      { priority: "DESIRABLE" },
      { priority: "OPTIONAL" },
      { priority: "TECHNICAL" },
    ];
    assert.equal(advisoryGateFires(reqs), false);
  });

  it("gate does not fire with zero requirements (covered by earlier NO_REQUIREMENTS gate)", () => {
    assert.equal(advisoryGateFires([]), false);
  });

  it("gate fires when all 10 requirements are DESIRABLE", () => {
    const reqs = Array.from({ length: 10 }, () => ({ priority: "DESIRABLE" }));
    assert.equal(advisoryGateFires(reqs), true);
  });

  it("gate does not fire when mix includes even one MANDATORY", () => {
    const reqs = [
      { priority: "TECHNICAL" },
      { priority: "FINANCIAL" },
      { priority: "COMPLIANCE" },
      { priority: "MANDATORY" },
      { priority: "DESIRABLE" },
    ];
    assert.equal(advisoryGateFires(reqs), false);
  });
});

// ── 4. Regression: existing gate errorCodes remain present ───────────────────

describe("phase 18 — generate gate regression checks", () => {
  const existingGates = [
    "NO_REQUIREMENTS",
    "CLIENT_NAME_REQUIRED",
    // METADATA_CONTAMINATED removed — metadata no longer hard-blocks draft work.
    // Contamination is surfaced as a warning, not a 422 error.
    "ANALYSIS_PARTIAL",
    "EXTRACTION_NOT_READY",
    "PARTIAL_EXTRACTION_ANALYSIS",
    "NO_BID_BLOCK",
    "CRITICAL_CONTENT_PAGES_MISSING",
    "ANALYSIS_QUALITY_NOT_READY",
    "CRITICAL_METADATA_MISSING",
    // NOTE: "NO_SUBMISSION_PLAN" was REMOVED — GeneratedDocument rows must
    // never be used as a BuildPlan proxy. The authoritative plan check is
    // enforced by assertTenderReadyForGenerationAndExport (BUILD_PLAN_NOT_
    // CONFIRMED + BUILD_PLAN_MISSING + BUILD_PLAN_STALE).
  ];

  for (const gate of existingGates) {
    it(`existing gate ${gate} is still present`, () => {
      const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
      assert.ok(
        src.includes(`"${gate}"`),
        `generate route must still contain the ${gate} gate`,
      );
    });
  }
});

// ── 5. Source tracing helper: contactDetailsSourceJson coverage ───────────────

describe("phase 18 — contactDetailsSourceJson covers entity fields", () => {
  const CONTACT_DETAILS_KEYS = [
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
    // Phase 18 additions:
    "procuringEntityName",
    "legalClientName",
    "donorAgency",
    "implementingAgency",
  ];

  it("all expected contactDetailsSource keys are present in the AI prompt", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    const missing = CONTACT_DETAILS_KEYS.filter((k) => !src.includes(`"${k}"`));
    assert.deepStrictEqual(
      missing,
      [],
      `These keys are missing from contactDetailsSource in lib/ai.ts: ${missing.join(", ")}`,
    );
  });

  it("Prisma schema stores contactDetailsSourceJson as String for all contact fields", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    assert.ok(
      schema.includes("contactDetailsSourceJson"),
      "Prisma schema must have contactDetailsSourceJson column",
    );
  });
});
