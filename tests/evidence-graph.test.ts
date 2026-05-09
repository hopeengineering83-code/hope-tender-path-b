// G7 — evidence graph pure-function tests.
// verifyEvidenceIds is the security-critical filter that drops
// hallucinated IDs before responses leave the server.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { verifyEvidenceIds, nodesByKind, type EvidenceGraph, type EvidenceNode } from "../lib/evidence-graph";

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
