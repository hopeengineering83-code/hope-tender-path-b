// Tests for detectAnalysisSourceWithApproval and assertAnalysisReadyForFinalGeneration.
//
// These cover all four AnalysisSource states and the gate helper, using an
// in-memory Prisma mock so no database is required.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectAnalysisSource,
  detectAnalysisSourceWithApproval,
  assertAnalysisReadyForFinalGeneration,
  ANALYSIS_APPROVAL_GAP_TITLE,
} from "../lib/engine/analysis-source";
import type { PrismaClient } from "@prisma/client";

// Minimal fake Prisma client that drives findFirst by a pre-set approval row.
function makeFakeClient(hasApproval: boolean): PrismaClient {
  return {
    complianceGap: {
      findFirst: async () =>
        hasApproval ? { id: "fake-approval-id" } : null,
    },
  } as unknown as PrismaClient;
}

const TENDER_ID = "tender-001";

// ─── detectAnalysisSource (sync) ─────────────────────────────────────────────

describe("detectAnalysisSource — sync helper", () => {
  it('returns "AI" when notes include "Analysis source: AI"', () => {
    const result = detectAnalysisSource({
      notes: "Analysis source: AI (chunked multi-call when tender > 60K chars).",
    });
    assert.equal(result, "AI");
  });

  it('returns "REGEX_FALLBACK_AI_ERROR" when notes include regex-fallback marker', () => {
    const result = detectAnalysisSource({
      notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR). AI providers timed out.",
    });
    assert.equal(result, "REGEX_FALLBACK_AI_ERROR");
  });

  it('returns "UNKNOWN" when notes are null', () => {
    assert.equal(detectAnalysisSource({ notes: null }), "UNKNOWN");
  });

  it('returns "UNKNOWN" when notes are empty', () => {
    assert.equal(detectAnalysisSource({ notes: "" }), "UNKNOWN");
  });

  it('returns "UNKNOWN" when notes contain unrelated text', () => {
    assert.equal(detectAnalysisSource({ notes: "Reviewed and confirmed." }), "UNKNOWN");
  });
});

// ─── detectAnalysisSourceWithApproval (async) ────────────────────────────────

describe("detectAnalysisSourceWithApproval — state 1: AI analysis", () => {
  it('returns "AI" without a DB lookup when notes say AI', async () => {
    const client = makeFakeClient(false);
    const result = await detectAnalysisSourceWithApproval(client, TENDER_ID, {
      notes: "Analysis source: AI.",
    });
    assert.equal(result, "AI");
  });
});

describe("detectAnalysisSourceWithApproval — state 2: REGEX_FALLBACK_AI_ERROR (no approval)", () => {
  it('returns "REGEX_FALLBACK_AI_ERROR" when regex fallback and no approval row', async () => {
    const client = makeFakeClient(false);
    const result = await detectAnalysisSourceWithApproval(client, TENDER_ID, {
      notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR).",
    });
    assert.equal(result, "REGEX_FALLBACK_AI_ERROR");
  });
});

describe("detectAnalysisSourceWithApproval — state 3: HUMAN_APPROVED_REGEX_FALLBACK", () => {
  it('returns "HUMAN_APPROVED_REGEX_FALLBACK" when regex fallback with approval row present', async () => {
    const client = makeFakeClient(true);
    const result = await detectAnalysisSourceWithApproval(client, TENDER_ID, {
      notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR).",
    });
    assert.equal(result, "HUMAN_APPROVED_REGEX_FALLBACK");
  });
});

describe("detectAnalysisSourceWithApproval — state 4: UNKNOWN", () => {
  it('returns "UNKNOWN" when notes are blank', async () => {
    const client = makeFakeClient(false);
    const result = await detectAnalysisSourceWithApproval(client, TENDER_ID, {
      notes: null,
    });
    assert.equal(result, "UNKNOWN");
  });
});

// ─── assertAnalysisReadyForFinalGeneration ────────────────────────────────────

describe("assertAnalysisReadyForFinalGeneration", () => {
  it('returns {ok: true} for AI analysis', async () => {
    const client = makeFakeClient(false);
    const gate = await assertAnalysisReadyForFinalGeneration(client, TENDER_ID, {
      notes: "Analysis source: AI.",
    });
    assert.equal(gate.ok, true);
  });

  it('returns {ok: false} for human-approved regex fallback (audit-only, never authorizes release)', async () => {
    // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK must NEVER authorize
    // generation, export, download, regeneration, AI proposal, missing-file
    // generation, or ZIP. Human approval is audit-only. A passing test here
    // proves the block is in place; if anyone re-allows human-approved
    // fallback in assertAnalysisReadyForFinalGeneration, this test fails.
    const client = makeFakeClient(true);
    const gate = await assertAnalysisReadyForFinalGeneration(client, TENDER_ID, {
      notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR).",
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.code, "ANALYSIS_REGEX_FALLBACK_UNAPPROVED");
      assert.match(gate.message, /audit-only/i);
      assert.ok(gate.nextAction.length > 0);
    }
  });

  it('returns {ok: false} for unapproved regex fallback', async () => {
    const client = makeFakeClient(false);
    const gate = await assertAnalysisReadyForFinalGeneration(client, TENDER_ID, {
      notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR).",
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.code, "ANALYSIS_REGEX_FALLBACK_UNAPPROVED");
      assert.ok(gate.message.length > 0);
      assert.ok(gate.nextAction.length > 0);
    }
  });

  it('returns {ok: false} for UNKNOWN analysis source', async () => {
    const client = makeFakeClient(false);
    const gate = await assertAnalysisReadyForFinalGeneration(client, TENDER_ID, {
      notes: null,
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.code, "ANALYSIS_REGEX_FALLBACK_UNAPPROVED");
    }
  });
});

// ─── ANALYSIS_APPROVAL_GAP_TITLE constant ─────────────────────────────────────

describe("ANALYSIS_APPROVAL_GAP_TITLE constant", () => {
  it("is the expected string", () => {
    assert.equal(ANALYSIS_APPROVAL_GAP_TITLE, "ANALYSIS_APPROVAL:REGEX_FALLBACK");
  });
});
