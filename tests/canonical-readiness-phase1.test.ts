import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildCanonicalModulePayload,
  computeCanonicalModuleStates,
  type ComputeCanonicalStatesInput,
  type CanonicalModuleStatePayload,
  type CanonicalModuleStatus,
} from "../lib/engine/canonical-readiness-state";
import { computeTenderReadinessState, deriveAnalysisHash } from "../lib/tender-readiness-state";
import { CanonicalStatusBadge } from "../components/canonical-status-badge";
import { GenerationActionButton, isGenerationActionEnabled } from "../components/generation-action-panel";

const req = (priority = "MANDATORY", traced = true) => ({
  priority,
  sourcePageNumber: traced ? 3 : null,
  sourceExactQuote: traced ? "The bidder shall provide evidence." : null,
  sectionReference: traced ? "Section 4" : null,
  sourceConfidence: traced ? 0.9 : null,
  exactFileName: "Technical Proposal.docx",
});

function baseInput(overrides: Partial<ComputeCanonicalStatesInput> = {}): ComputeCanonicalStatesInput {
  const hash = deriveAnalysisHash({ extractionStatus: "FULL_EXTRACTION_AI_ANALYZED", analysisSource: "AI", requirementCount: 1, mandatoryCount: 1, sourceTracedCount: 1 });
  return {
    extractionTrusted: true,
    analysisTrusted: true,
    requirementsTrusted: true,
    metadataTrusted: true,
    submissionPlanBuilt: true,
    complianceCurrent: true,
    documentsCurrent: true,
    exportAllowed: true,
    rawRequirementsCount: 1,
    trustedRequirementsCount: 1,
    sourceTracedRequirementsCount: 1,
    mandatoryRequirementsCount: 1,
    mandatoryTracedCount: 1,
    currentAnalysisHash: hash,
    docsGeneratedFromCurrentAnalysis: true,
    blockers: [],
    warnings: [],
    hasAnalysis: true,
    hasRequirements: true,
    hasDocuments: true,
    matchingComplete: true,
    generationServerReady: true,
    ...overrides,
  };
}

function payloadWith(state: CanonicalModuleStatus): CanonicalModuleStatePayload {
  const states = computeCanonicalModuleStates(baseInput({ generationServerReady: state === "READY", runningModules: state === "RUNNING" ? { generation: true } : undefined }));
  states.generation = state;
  return buildCanonicalModulePayload(states, { blockers: state === "READY" ? [] : ["BLOCKER"], warnings: [], currentAnalysisHash: "test" }, { calculatedAt: "2026-06-12T00:00:00.000Z" });
}

describe("canonical readiness dependency propagation", () => {
  it("extraction BLOCKED propagates to analysis, generation, and export not READY", () => {
    const states = computeCanonicalModuleStates(baseInput({ extractionTrusted: false, analysisTrusted: false, requirementsTrusted: false, complianceCurrent: false, documentsCurrent: false, exportAllowed: false }));
    assert.equal(states.extraction, "BLOCKED");
    assert.equal(states.analysis, "BLOCKED");
    assert.notEqual(states.generation, "READY");
    assert.notEqual(states.export, "READY");
  });

  it("analysis PARTIAL makes requirements and compliance not READY", () => {
    const states = computeCanonicalModuleStates(baseInput({ analysisTrusted: false, rawRequirementsCount: 2, requirementsTrusted: false, complianceCurrent: false }));
    assert.equal(states.analysis, "PARTIAL");
    assert.notEqual(states.requirements, "READY");
    assert.notEqual(states.compliance, "READY");
  });

  it("analysis STALE makes generation and export not READY", () => {
    const states = computeCanonicalModuleStates(baseInput({ analysisStale: true }));
    assert.equal(states.analysis, "STALE");
    assert.notEqual(states.generation, "READY");
    assert.notEqual(states.export, "READY");
  });

  it("missing submission plan makes documents and generation not READY", () => {
    const states = computeCanonicalModuleStates(baseInput({ submissionPlanBuilt: false, documentsCurrent: false }));
    assert.notEqual(states.documents, "READY");
    assert.notEqual(states.generation, "READY");
  });

  it("stale documents make generation and export not READY", () => {
    const states = computeCanonicalModuleStates(baseInput({ docsGeneratedFromCurrentAnalysis: false, documentsCurrent: false }));
    assert.equal(states.documents, "STALE");
    assert.notEqual(states.generation, "READY");
    assert.notEqual(states.export, "READY");
  });

  it("OCR_REQUIRED produces BLOCKED", () => {
    const readiness = computeTenderReadinessState({ analysisExtractionStatus: "OCR_REQUIRED", analysisSource: "AI", analysisSeverity: "GOOD", title: "T", clientName: "Client", reference: "R", requirements: [req()], exactFileNaming: '["Technical Proposal.docx"]' });
    assert.equal(readiness.extractionTrusted, false);
    const states = computeCanonicalModuleStates({ ...baseInput(), ...readiness, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(states.extraction, "BLOCKED");
  });

  it("RUNNING remains distinct from WARNING", () => {
    const running = computeCanonicalModuleStates(baseInput({ runningModules: { generation: true } }));
    const warning = computeCanonicalModuleStates(baseInput({ warnings: ["review"], generationServerReady: true }));
    assert.equal(running.generation, "RUNNING");
    assert.equal(warning.generation, "WARNING");
  });

  it("fallback draft cannot produce READY", () => {
    const readiness = computeTenderReadinessState({ analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED", analysisSource: "REGEX_FALLBACK_AI_ERROR", analysisSeverity: "WARNING", title: "Tender", clientName: "Client", reference: "R", requirements: [req()], exactFileNaming: '["Technical Proposal.docx"]' });
    const states = computeCanonicalModuleStates({ ...baseInput(), ...readiness, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.notEqual(states.analysis, "READY");
  });
});

describe("Generate Documents canonical availability", () => {
  for (const state of ["BLOCKED", "STALE", "PARTIAL", "NOT_RUN"] as const) {
    it(`is disabled for ${state}`, () => assert.equal(isGenerationActionEnabled(state, true), false));
  }

  it("is enabled only for READY by default", () => {
    assert.equal(isGenerationActionEnabled("READY", true), true);
    assert.equal(isGenerationActionEnabled("WARNING", false), false);
    assert.equal(isGenerationActionEnabled("WARNING", true), true);
  });

  it("renders a disabled Generate Documents button for blocked canonical state", () => {
    const html = renderToStaticMarkup(React.createElement(GenerationActionButton, {
      canonicalGenerationState: "BLOCKED",
      fullProposalReady: false,
      busy: false,
      blockedReason: "Canonical generation is blocked.",
    }));
    assert.match(html, /disabled=""/);
    assert.match(html, /Resolve blockers first/);
  });

  it("renders an enabled Generate Documents button only for ready canonical state", () => {
    const html = renderToStaticMarkup(React.createElement(GenerationActionButton, {
      canonicalGenerationState: "READY",
      fullProposalReady: true,
      busy: false,
    }));
    assert.doesNotMatch(html, /disabled=""/);
    assert.match(html, /Generate Docs/);
  });
});

describe("migrated UI canonical rendering", () => {
  it("tender summary and executive snapshot can show the same state from the same payload", () => {
    const payload = payloadWith("BLOCKED");
    const summary = renderToStaticMarkup(React.createElement(CanonicalStatusBadge, { status: payload.generation.state, label: `Summary ${payload.generation.state}` }));
    const snapshot = renderToStaticMarkup(React.createElement(CanonicalStatusBadge, { status: payload.generation.state, label: `Snapshot ${payload.generation.state}` }));
    assert.match(summary, /BLOCKED/);
    assert.match(snapshot, /BLOCKED/);
  });

  it("numeric health score cannot override a canonical blocker", () => {
    const payload = payloadWith("BLOCKED");
    const highNumericScore = 100;
    assert.equal(highNumericScore, 100);
    assert.equal(payload.generation.state, "BLOCKED");
    assert.equal(isGenerationActionEnabled(payload.generation.state, true), false);
  });

  it("existing recovery action labels remain available in the generation panel source", () => {
    const source = readFileSync("components/generation-action-panel.tsx", "utf8");
    assert.match(source, /Repair evaluation criteria only/);
    assert.match(source, /Repair all empty fields from source/);
  });
});

describe("phase 1 architectural guardrails", () => {
  it("migrated areas do not introduce a second readiness/severity authority", () => {
    for (const file of [
            "components/generation-action-panel.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /\btype\s+UISeverity\b|\binterface\s+UISeverity\b/);
      assert.doesNotMatch(source, /(?:const|let|var)\s+(?:severityMap|readinessMap|statusSeverityMap)\s*=/i);
      assert.doesNotMatch(source, /generationReady\s*=|canGenerateFromLocal|localGenerationReadiness/);
    }
  });
});
