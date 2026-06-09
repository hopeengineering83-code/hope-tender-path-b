import test from "node:test";
import assert from "node:assert/strict";
import { scoreProposalQuality } from "../lib/engine/proposal-quality-scorer";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";

test("Document Quality Validator: Blocks AI traces and placeholders", async () => {
  const badDoc = {
    name: "Technical Proposal",
    documentType: "TECHNICAL",
    fileContent: "# Section A\n\nAs an AI language model, I cannot provide this content. [INSERT NAME HERE] needs to confirm.",
    storagePath: null
  };

  const result = validateDocumentQuality(badDoc);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.aiTrace.length > 0);
  assert.ok(result.placeholders.length > 0);
  assert.ok(result.score <= 35);
});

test("Document Quality Validator: Blocks high generic boilerplate", async () => {
  const genericDoc = {
    name: "Methodology",
    documentType: "TECHNICAL",
    fileContent: "# Methodology\n\nWe are committed to excellence. We are a leading firm in the region with a team of qualified professionals. We provide innovative solutions and streamlined operations with enhanced efficiency. Our best practices are second to none.",
    storagePath: null
  };

  const result = validateDocumentQuality(genericDoc);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.qualityWarnings.some(w => w.includes("High generic boilerplate")));
});

test("Document Quality Validator: Allows clean professional text", async () => {
  const goodDoc = {
    name: "Project Experience",
    documentType: "TECHNICAL",
    fileContent: "# Section B: Relevant Experience\n\nHope Engineering has completed over 50 hydraulic projects in East Africa since 2010. One notable project is the Addis Ababa Water Supply Scheme (2018), valued at ETB 450M, where we installed 12km of DN600 ductile iron pipe. The project was completed on time and within budget, demonstrating our capacity for large-scale infrastructure.",
    storagePath: null
  };

  const result = validateDocumentQuality(goodDoc);
  assert.ok(result.status === "GOOD" || result.status === "WARNING", "Status should be GOOD or WARNING");
});

test("Proposal Quality Scorer: Penalizes placeholders and AI traces", async () => {
  const md = "# Cover Letter\n\n[INSERT CLIENT] - Bid-Team to confirm.\n\n# Executive Summary\n\nAs an AI language model, I have prepared this draft.\n\n# Section A\n\n[TBD]";
  const score = scoreProposalQuality({
    markdown: md,
    primarySector: "Water",
    topProjects: []
  });

  assert.ok(score.total < 50, "Score should be low for placeholder-heavy content");
  assert.ok(score.weakAxes.includes("aiTraceFreedom"));
  assert.ok(score.weakAxes.includes("evidenceDensity"));
});

test("Proposal Quality Scorer: Rewards evidence and structure", async () => {
  const md = "# Cover Letter\n\nDear Addis Ababa Water Authority, we are pleased to submit our proposal for the Sewerage Upgrade project.\n\n# Executive Summary\n\nHope Engineering brings 15 years of experience in sewerage systems. Our team has handled projects like the Akaki Treatment Plant expansion.\n\n# Section A: Project Organisation\n\nOur team is led by Dr. Samuel Bekele (License #12345). We have allocated 15 specialists for this 12-month contract.\n\n# Section B: Relevant Experience\n\n1. Addis Ababa Water Supply Scheme (2018) - ETB 450M. Installed DN600 pipes.\n\n# Section C: Methodology\n\n### C.2.1 Pipeline Excavation\nSubstantive content about excavation methods.\n### C.2.2 Pipe Laying\nDetails about pipe laying.\n### C.2.3 Pressure Testing\nTesting procedures.\n### C.2.4 Backfilling\nCompaction details.\n### C.2.5 Site Restoration\nCleaning up.\n### C.2.6 Documentation\nAs-built drawings.\n\n# Section D: Key Personnel\n\nRelevant details about personnel.\n\n# Declaration\n\nSigned on this day.";

  const score = scoreProposalQuality({
    markdown: md,
    primarySector: "Water",
    topProjects: [{ name: "Addis Ababa Water Supply Scheme", id: "p1" }]
  });

  assert.ok(score.total > 30, "Score should be non-zero for evidence-rich content");
});
