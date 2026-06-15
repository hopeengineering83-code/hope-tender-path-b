// G7 — evidence graph pure-function tests.
// verifyEvidenceIds is the security-critical filter that drops
// hallucinated IDs before responses leave the server.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { verifyEvidenceIds, nodesByKind, type EvidenceGraph, type EvidenceNode } from "../lib/evidence-graph";
import { buildEvidenceGraph as buildSelectionEvidenceGraph, renderEvidenceGraph as renderSelectionEvidenceGraph } from "../lib/engine/matching/evidence-graph";
import { buildProposalIntelligenceContract, renderProposalIntelligencePromptBlock } from "../lib/engine/generation/proposal-intelligence-contract";

const node = (id: string, kind: EvidenceNode["kind"], label: string): EvidenceNode => ({ id, kind, label });

const graph: EvidenceGraph = (() => {
  const byId = new Map<string, EvidenceNode>();
  const byKind = new Map<EvidenceNode["kind"], EvidenceNode[]>();
  const push = (n: EvidenceNode) => {
    byId.set(n.id, n);
    const list = byKind.get(n.kind) ?? [];
    list.push(n);
    byKind.set(n.kind, list);
  };
  push(node("req-1", "REQUIREMENT", "Mandatory licence"));
  push(node("exp-1", "EXPERT", "Ahmed Kebede"));
  push(node("prj-1", "PROJECT", "Dessie Museum"));
  return { tenderId: "t-1", byId, byKind };
})();

describe("verifyEvidenceIds", () => {
  it("returns verified nodes when all IDs exist", () => {
    const { verified, dropped } = verifyEvidenceIds(graph, ["req-1", "exp-1"]);
    assert.equal(verified.length, 2);
    assert.equal(dropped.length, 0);
  });

  it("drops hallucinated IDs", () => {
    const { verified, dropped } = verifyEvidenceIds(graph, ["req-1", "ghost-id"]);
    assert.equal(verified.length, 1);
    assert.deepEqual(dropped, ["ghost-id"]);
  });

  it("dedupes duplicate IDs", () => {
    const { verified } = verifyEvidenceIds(graph, ["req-1", "req-1", "req-1"]);
    assert.equal(verified.length, 1);
  });

  it("ignores non-string entries", () => {
    const { verified, dropped } = verifyEvidenceIds(graph, ["req-1", null as unknown as string, undefined as unknown as string]);
    assert.equal(verified.length, 1);
    assert.equal(dropped.length, 0);
  });

  it("trims whitespace before lookup", () => {
    const { verified } = verifyEvidenceIds(graph, ["  exp-1  "]);
    assert.equal(verified.length, 1);
  });
});

describe("nodesByKind", () => {
  it("filters to one kind", () => {
    const all = [node("a", "EXPERT", "x"), node("b", "PROJECT", "y"), node("c", "EXPERT", "z")];
    const experts = nodesByKind(all, "EXPERT");
    assert.equal(experts.length, 2);
    assert.ok(experts.every((n) => n.kind === "EXPERT"));
  });
});

const hospitalTender = {
  tenderTitle: "RFP for Hospital Architectural Design, Interior Design, Supervision and Contract Administration",
  clientName: "Health Client",
  requirements: [
    "The consultant shall provide hospital design, interior design, supervision and contract administration methodology.",
    "Bidders must submit similar healthcare project references and CVs for key experts.",
  ],
};

describe("engine evidence graph selection model", () => {
  it("ranks hospital project evidence above warehouse evidence for a hospital tender", () => {
    const selectionGraph = buildSelectionEvidenceGraph({
      ...hospitalTender,
      projectLines: [
        "Reviewed project: Warehouse logistics facility design and cargo storage supervision for industrial client, completed 2024, ETB 20,000,000.",
        "Reviewed project: Hospital and specialty clinic architectural design, interior design, supervision, contract administration and handover for healthcare client, completed 2024 with completion certificate.",
      ],
      expertLines: [],
    });

    const hospital = selectionGraph.nodes.find((item) => item.text.includes("Hospital and specialty clinic"));
    const warehouse = selectionGraph.nodes.find((item) => item.text.includes("Warehouse logistics"));

    assert.ok(hospital);
    assert.ok(warehouse);
    assert.equal(selectionGraph.summary.topProjectId, hospital?.id);
    assert.equal(warehouse?.evidenceClass, "UNFIT");
    assert.ok(warehouse?.riskFlags.includes("UNSAFE_SECTOR_MISMATCH"));
    assert.ok((hospital?.score.total ?? 0) > (warehouse?.score.total ?? 0));
  });

  it("classifies strong expert evidence as direct or transferable and weak evidence as unfit", () => {
    const selectionGraph = buildSelectionEvidenceGraph({
      ...hospitalTender,
      projectLines: [],
      expertLines: [
        "Reviewed expert: Senior Architect, hospital design lead, interior design coordination, supervision and contract administration CV checked, healthcare projects 2024.",
        "Placeholder expert to be confirmed later.",
      ],
    });

    const architect = selectionGraph.nodes.find((item) => item.text.includes("Senior Architect"));
    const placeholder = selectionGraph.nodes.find((item) => item.text.includes("Placeholder expert"));

    assert.ok(architect);
    assert.ok(["DIRECT", "TRANSFERABLE"].includes(architect?.evidenceClass ?? ""));
    assert.equal(placeholder?.evidenceClass, "UNFIT");
    assert.ok(placeholder?.riskFlags.includes("PLACEHOLDER_OR_UNCONFIRMED"));
    assert.equal(selectionGraph.summary.topExpertId, architect?.id);
  });

  it("renders evidence graph output for proposal controls", () => {
    const selectionGraph = buildSelectionEvidenceGraph({
      ...hospitalTender,
      projectLines: ["Reviewed project: Hospital design and supervision for healthcare client, completion certificate, 2024."],
      expertLines: ["Reviewed expert: Senior Architect with hospital design CV checked, 2024."],
    });
    const rendered = renderSelectionEvidenceGraph({ graph: selectionGraph });

    assert.match(rendered, /Evidence Graph Selection Model/i);
    assert.match(rendered, /Top project/i);
    assert.match(rendered, /DIRECT|TRANSFERABLE|SUPPORTING/i);
  });

  it("adds evidence graph summaries and gates to the proposal intelligence contract", () => {
    const contract = buildProposalIntelligenceContract({
      ...hospitalTender,
      expertLines: ["Reviewed expert: Senior Architect with hospital design and supervision CV checked, 2024."],
      projectLines: [
        "Reviewed project: Warehouse logistics facility design and cargo storage supervision for industrial client, completed 2024.",
        "Reviewed project: Hospital architectural design, interior design, supervision and contract administration for healthcare client, completion certificate, 2024.",
      ],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      differentiators: [],
    });
    const prompt = renderProposalIntelligencePromptBlock({
      ...hospitalTender,
      expertLines: ["Reviewed expert: Senior Architect with hospital design and supervision CV checked, 2024."],
      projectLines: ["Reviewed project: Hospital architectural design, interior design, supervision and contract administration for healthcare client, completion certificate, 2024."],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      differentiators: [],
    });

    assert.equal(contract.schemaVersion, "PIC-3");
    assert.ok(contract.evidenceGraph.nodes.length >= 2);
    assert.ok(contract.exportGates.some((item) => item.gate === "Evidence graph fit control"));
    assert.ok(contract.evidenceSummary.unsafeEvidenceMismatches >= 1);
    assert.match(prompt, /Evidence graph/i);
  });
});
