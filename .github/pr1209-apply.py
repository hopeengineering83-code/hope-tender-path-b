from __future__ import annotations

from pathlib import Path
import re


def sub_required(path: str, pattern: str, replacement: str, *, flags: int = 0) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}: {pattern[:120]!r}; found {count}")
    file_path.write_text(updated)


sub_required(
    "app/api/tenders/[id]/generate/route.ts",
    r'^import \{ isValidClientName, containsMetadataPlaceholder \} from "\.\./\.\./\.\./\.\./\.\./lib/engine/metadata-validators";\n',
    "",
    flags=re.MULTILINE,
)
sub_required(
    "app/api/tenders/[id]/metadata-override/route.ts",
    r'^\s{2}classifyTenderFactAuthority,\n',
    "",
    flags=re.MULTILINE,
)
sub_required(
    "app/api/tenders/[id]/metadata-override/route.ts",
    r'^\s{2}// rejectInvalidTenderFact is imported as an explicit contract marker —\n(?:^\s{2}//.*\n){6}^\s{2}rejectInvalidTenderFact,\n',
    "",
    flags=re.MULTILINE,
)
sub_required(
    "lib/engine/canonical-field-state.ts",
    r'^\s{4}// ledgerOverridesValue is tracked as an explicit contract marker — the\n(?:^\s{4}//.*\n){6}^\s{4}let ledgerOverridesValue = false;\n',
    "",
    flags=re.MULTILINE,
)
sub_required(
    "lib/engine/canonical-field-state.ts",
    r'^\s{10}ledgerOverridesValue = true;\n',
    "",
    flags=re.MULTILINE,
)
sub_required(
    "lib/engine/canonical-field-state.ts",
    r'^\s{4}// valueDrivenUngroundedBlock is explicitly disabled — the authority model\n(?:^\s{4}//.*\n){4}^\s{4}const valueDrivenUngroundedBlock = false;\n\n',
    "",
    flags=re.MULTILINE,
)

Path("app/api/tenders/[id]/reconcile-state/route.ts").write_text('''import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { resolveTenderAnalysisState } from "../../../../../lib/engine/analysis-state-resolver";
import { logAction } from "../../../../../lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const { id: tenderId } = await params;
    await prismaReady;

    const analysisInfo = await resolveTenderAnalysisState(prisma, tenderId, actor.id);

    // Reconcile workflow status only. Extraction quality is an independent
    // source-file fact: AI success does not prove OCR or page extraction was complete.
    const status = analysisInfo.state === "AI_SUCCEEDED" ? "ANALYZED" : undefined;
    await prisma.tender.update({
      where: { id: tenderId },
      data: {
        updatedAt: new Date(),
        ...(status ? { status } : {}),
      },
    });

    await logAction({
      userId: actor.id,
      action: "TENDER_UPDATE",
      entityType: "Tender",
      entityId: tenderId,
      description: `Owner triggered state reconciliation. Resolved state: ${analysisInfo.state}`,
    });

    return NextResponse.json({ ok: true, analysisInfo });
  } catch (error) {
    logger.error("[reconcile-state]", { detail: error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
''')

sanitize_path = Path("lib/sanitize-error.ts")
sanitize = sanitize_path.read_text()
for old, new in {
    '.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]")': '.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[KEY_REDACTED]")',
    '.replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")': '.replace(/AIza[a-zA-Z0-9_-]{20,}/g, "[KEY_REDACTED]")',
    '.replace(/Bearer\\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]")': '.replace(/Bearer\\s+[^\\s,;]+/gi, "Bearer [REDACTED]")',
    '.replace(/api_key=[a-zA-Z0-9_-]{10,}/gi, "api_key=[KEY_REDACTED]")': '.replace(/(api[_-]?key\\s*[:=]\\s*)[^\\s&,;]+/gi, "$1[KEY_REDACTED]")',
}.items():
    if old not in sanitize:
        raise SystemExit(f"sanitize contract not found: {old}")
    sanitize = sanitize.replace(old, new, 1)
sanitize_path.write_text(sanitize)

Path("tests/fallback-never-authorizes-generation.test.ts").write_text('''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  analysisStateLabel,
  canExportWithAnalysisState,
  canResumeAnalysis,
  deriveAnalysisStateDetail,
  type DeriveAnalysisStateInput,
  type ResolverJobInput,
} from "../lib/engine/analysis-state-resolver";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function job(overrides: Partial<ResolverJobInput> = {}): ResolverJobInput {
  return {
    id: "job-1", status: "SUCCEEDED", analysisInputHash: "hash-1",
    stagedMergedResult: null, promotedAt: NOW, supersededBy: null,
    startedAt: NOW, finishedAt: NOW, errorMessage: null, ...overrides,
  };
}

function input(overrides: Partial<DeriveAnalysisStateInput> = {}): DeriveAnalysisStateInput {
  return {
    job: job(), chunks: [{ status: "SUCCEEDED", provider: "gemini" }],
    legacyNotesAiAnalyzed: false, requirementsExtracted: 2,
    requirementsPersisted: 2, sourceReferencesCreated: true,
    metadataFieldsPersisted: true, sectionsDetectedButNoRequirements: false,
    ...overrides,
  };
}

describe("canonical analysis state remains fail-closed", () => {
  it("blocks a promoted human-approved fallback from export", () => {
    const result = deriveAnalysisStateDetail(input({
      job: job({ status: "FAILED", stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }), promotedAt: NOW }),
      chunks: [{ status: "FAILED", provider: "gemini" }],
    }));
    assert.equal(result.state, "HUMAN_APPROVED_FALLBACK");
    assert.equal(result.analysisSource, "REGEX_FALLBACK");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), false);
    assert.match(result.nextAction, /lower confidence/i);
  });

  it("keeps an unapproved fallback resumable but not exportable", () => {
    const result = deriveAnalysisStateDetail(input({
      job: job({ status: "FAILED", stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }), promotedAt: null }),
      chunks: [{ status: "FAILED", provider: "gemini" }],
    }));
    assert.equal(result.state, "REGEX_FALLBACK_UNAPPROVED");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), true);
  });

  it("blocks a succeeded job that was never canonically promoted", () => {
    const result = deriveAnalysisStateDetail(input({ job: job({ status: "SUCCEEDED", promotedAt: null }) }));
    assert.equal(result.state, "FAILED");
    assert.equal(result.canonicalJobId, null);
    assert.equal(canExportWithAnalysisState(result.state), false);
  });

  it("blocks promoted analysis while any chunk remains incomplete", () => {
    const result = deriveAnalysisStateDetail(input({ chunks: [
      { status: "SUCCEEDED", provider: "gemini" },
      { status: "FAILED", provider: "openrouter" },
    ] }));
    assert.equal(result.state, "PARTIAL_NEEDS_RESUME");
    assert.equal(result.completedChunks, 1);
    assert.equal(result.totalChunks, 2);
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), true);
  });

  it("blocks superseded analysis even when its prior run succeeded", () => {
    const result = deriveAnalysisStateDetail(input({ job: job({ supersededBy: "job-2" }) }));
    assert.equal(result.state, "SUPERSEDED");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), false);
  });

  it("blocks detected sections when no structured requirements were produced", () => {
    const result = deriveAnalysisStateDetail(input({
      requirementsExtracted: 0, requirementsPersisted: 0, sectionsDetectedButNoRequirements: true,
    }));
    assert.equal(result.state, "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), true);
  });

  it("allows only promoted, complete AI success", () => {
    const result = deriveAnalysisStateDetail(input());
    assert.equal(result.state, "AI_SUCCEEDED");
    assert.equal(result.canonicalJobId, "job-1");
    assert.equal(canExportWithAnalysisState(result.state), true);
    assert.equal(canResumeAnalysis(result.state), false);
    assert.equal(analysisStateLabel(result.state), "Analysis Complete");
  });
});
''')

Path("tests/reconcile-state-preserves-extraction-quality.test.ts").write_text('''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/reconcile-state/route.ts", "utf8");

describe("reconcile-state preserves independent extraction-quality truth", () => {
  it("may reconcile workflow status but never promotes extraction quality to FULL", () => {
    assert.match(source, /analysisInfo\\.state\\s*===\\s*"AI_SUCCEEDED"/);
    assert.match(source, /status\\s*=\\s*analysisInfo\\.state/);
    assert.equal(source.includes('analysisExtractionStatus = "FULL_EXTRACTION_AI_ANALYZED"'), false);
    assert.equal(source.includes('analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED"'), false);
  });
});
''')

Path("tests/redact-secrets.test.ts").write_text('''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { redactSecrets, sanitizeError } from "../lib/sanitize-error";

describe("redactSecrets", () => {
  it("redacts provider keys, bearer tokens, named API-key assignments, and connection strings", () => {
    const providerKey = ["s", "k", "-", "abcdefgh_123456"].join("");
    const googleKey = ["AI", "za", "1234567890abcdefghijklmnop"].join("");
    const bearerValue = ["header", "payload", "signature"].join(".");
    const namedKey = ["super", "secret", "value"].join("-");
    const alternateKey = ["another", "secret"].join("-");
    const databaseCredential = ["user", "password"].join(":");
    const cacheCredential = ["default", "password"].join(":");
    const databaseUrl = ["post", "gresql://", databaseCredential, "@db.example.test:5432/app"].join("");
    const cacheUrl = ["re", "dis://", cacheCredential, "@cache.example.test:6379"].join("");
    const input = [providerKey, googleKey, `Bearer ${bearerValue}`, `API_KEY = ${namedKey}`, `api-key: ${alternateKey}`, databaseUrl, cacheUrl].join(" | ");
    const redacted = redactSecrets(input);
    for (const sensitive of [providerKey, googleKey, bearerValue, namedKey, alternateKey, databaseCredential, cacheCredential]) {
      assert.equal(redacted.includes(sensitive), false);
    }
    assert.match(redacted, /API_KEY\\s*=\\s*\\[KEY_REDACTED\\]/i);
    assert.match(redacted, /api-key:\\s*\\[KEY_REDACTED\\]/i);
    assert.match(redacted, /postgresql:\\/\\/\\[redacted\\]/i);
    assert.match(redacted, /redis:\\/\\/\\[redacted\\]/i);
  });

  it("leaves ordinary diagnostic text unchanged", () => {
    const message = "Provider returned timeout after 30 seconds";
    assert.equal(redactSecrets(message), message);
  });

  it("sanitizeError composes secret and database-detail redaction", () => {
    const namedKey = ["secret", "value", "123"].join("-");
    const result = sanitizeError(["PrismaClientKnownRequestError", `API_KEY=${namedKey}`, "SELECT password FROM users"].join(" "));
    assert.equal(result.includes(namedKey), false);
    assert.equal(result.includes("PrismaClientKnownRequestError"), false);
    assert.equal(result.includes("SELECT password FROM users"), false);
  });
});
''')

sub_required(
    "tests/tender-fact-authority.test.ts",
    r'^\s{4}assert\.ok\(src\.includes\("classifyTenderFactAuthority"\), "must import classifyTenderFactAuthority"\);\n',
    '    assert.ok(!src.includes("  classifyTenderFactAuthority,"), "must not retain an unused classifier import");\n',
    flags=re.MULTILINE,
)
sub_required(
    "tests/tender-fact-authority.test.ts",
    r'^\s{4}// The old valueDrivenUngroundedBlock must be disabled\n^\s{4}assert\.ok\(src\.includes\("valueDrivenUngroundedBlock = false"\), "must disable valueDrivenUngroundedBlock"\);\n',
    '    // The obsolete value-driven blocker must be absent; final authority is enforced by export eligibility.\n    assert.ok(!src.includes("valueDrivenUngroundedBlock"), "must remove the dead value-driven blocker marker");\n',
    flags=re.MULTILINE,
)
sub_required(
    "tests/tender-facts-ledger-runtime-authority.test.ts",
    r'^\s{4}assert\.ok\(src\.includes\("rejectInvalidTenderFact"\), "must import rejectInvalidTenderFact"\);\n',
    '    assert.ok(!src.includes("rejectInvalidTenderFact"), "must not retain an unused rejection import");\n',
    flags=re.MULTILINE,
)
sub_required(
    "tests/tender-facts-ledger-runtime-authority.test.ts",
    r'^\s{4}assert\.ok\(src\.includes\("ledgerOverridesValue"\), "must track when ledger overrides value"\);\n',
    '    assert.ok(!src.includes("ledgerOverridesValue"), "must not retain a write-only ledger marker");\n',
    flags=re.MULTILINE,
)
