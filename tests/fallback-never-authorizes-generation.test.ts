import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  canGenerateFromState,
  getStateMessage,
  getTenderAnalysisState,
} from "../lib/ai-analyze/state-resolver";
import { computeTenderAnalysisContentHash } from "../lib/ai-analyze/content-hash";

function mockPrisma(job: Record<string, unknown>, tender?: Record<string, unknown>) {
  return {
    aiJob: {
      findFirst: async () => job,
    },
    tender: {
      findFirst: async () => tender ?? null,
    },
  } as any;
}

const tenderContentRow = {
  id: "tender-1",
  title: "Road Design Tender",
  description: "Consultancy services",
  deadline: new Date("2026-12-31T00:00:00.000Z"),
  reference: "RFP-001",
  clientName: "Public Client",
  budget: null,
  country: "Ethiopia",
  submissionMethod: "Email",
  userId: "user-1",
  user: {
    company: {
      name: "Hope",
      legalName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
      foundingYear: 2018,
    },
  },
  files: [
    { id: "file-1", extractedText: "Mandatory technical and financial requirements." },
  ],
};

const expectedHash = computeTenderAnalysisContentHash({
  tenderId: "tender-1",
  fileHashes: [
    {
      fileId: "file-1",
      fileContentHash: "c36003e8dd4285e2bca25619f8861aac5d39cb07e759f4641e5d7a73de23681d",
    },
  ],
  tenderMetadata: {
    title: "Road Design Tender",
    description: "Consultancy services",
    deadline: "2026-12-31T00:00:00.000Z",
    reference: "RFP-001",
    clientName: "Public Client",
    budget: null,
    country: "Ethiopia",
    submissionMethod: "Email",
  },
  companyMetadata: {
    name: "Hope",
    legalName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
    foundingYear: 2018,
  },
});

describe("fallback and stale AI state never authorize generation", () => {
  it("treats human-approved regex fallback as audit-only", async () => {
    const result = await getTenderAnalysisState(
      "tender-1",
      "user-1",
      mockPrisma({
        id: "job-fallback",
        status: "HUMAN_APPROVED_FALLBACK",
        analysisVersion: 1n,
        analysisInputHash: "fallback-hash",
        promotedAt: new Date(),
        analyzeChunks: [],
      }),
    );

    assert.equal(result.state, "HUMAN_APPROVED_FALLBACK");
    assert.equal(result.canGenerate, false);
    assert.match(result.error ?? "", /audit only/i);
    assert.equal(canGenerateFromState("HUMAN_APPROVED_FALLBACK"), false);
    assert.match(getStateMessage("HUMAN_APPROVED_FALLBACK"), /Re-run AI Analyze/i);
  });

  it("blocks a SUCCEEDED job that was never canonically promoted", async () => {
    const result = await getTenderAnalysisState(
      "tender-1",
      "user-1",
      mockPrisma({
        id: "job-unpromoted",
        status: "SUCCEEDED",
        analysisVersion: 2n,
        analysisInputHash: expectedHash,
        promotedAt: null,
        analyzeChunks: [],
      }),
    );

    assert.equal(result.canGenerate, false);
    assert.equal(result.state, "FAILED");
    assert.match(result.error ?? "", /not promoted/i);
  });

  it("blocks a promoted job when the current tender hash differs", async () => {
    const result = await getTenderAnalysisState(
      "tender-1",
      "user-1",
      mockPrisma(
        {
          id: "job-stale",
          status: "SUCCEEDED",
          analysisVersion: 3n,
          analysisInputHash: "stale-content-hash",
          promotedAt: new Date(),
          analyzeChunks: [],
        },
        tenderContentRow,
      ),
    );

    assert.equal(result.canGenerate, false);
    assert.equal(result.state, "SUPERSEDED");
    assert.match(result.error ?? "", /content changed/i);
  });

  it("blocks promoted analysis with any incomplete chunk", async () => {
    const result = await getTenderAnalysisState(
      "tender-1",
      "user-1",
      mockPrisma(
        {
          id: "job-partial",
          status: "SUCCEEDED",
          analysisVersion: 4n,
          analysisInputHash: expectedHash,
          promotedAt: new Date(),
          analyzeChunks: [
            { chunkIndex: 0, status: "SUCCEEDED" },
            { chunkIndex: 1, status: "FAILED" },
          ],
        },
        tenderContentRow,
      ),
    );

    assert.equal(result.canGenerate, false);
    assert.equal(result.state, "PARTIAL_NEEDS_RESUME");
    assert.equal(result.requiresResume, true);
  });

  it("allows only promoted, current-hash, complete AI success", async () => {
    const result = await getTenderAnalysisState(
      "tender-1",
      "user-1",
      mockPrisma(
        {
          id: "job-current",
          status: "SUCCEEDED",
          analysisVersion: 5n,
          analysisInputHash: expectedHash,
          promotedAt: new Date(),
          analyzeChunks: [
            { chunkIndex: 0, status: "SUCCEEDED" },
            { chunkIndex: 1, status: "SUCCEEDED" },
          ],
        },
        tenderContentRow,
      ),
    );

    assert.equal(result.state, "AI_SUCCEEDED");
    assert.equal(result.canGenerate, true);
    assert.equal(canGenerateFromState(result.state), true);
  });
});
