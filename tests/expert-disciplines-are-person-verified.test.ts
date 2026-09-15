import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { sourceVerifiedListElements, SOURCE_VERIFICATION_PROVENANCE_PREFIX } from "../lib/vault-review-provenance";
import type { ReviewRecordState } from "../lib/vault-review-provenance";

/**
 * A delivered proposal presented one General Manager as practising
 * Architecture, Urban Planning, Structural Engineering, Civil Engineering,
 * Geotechnical Engineering, Electrical Engineering, Mechanical Engineering,
 * Quantity Surveying, Materials Engineering and Highway Engineering.
 *
 * Ten professions for one person reads to an evaluator as a firm's service
 * list pasted under an individual's name, and it puts every other claim in the
 * document in doubt. The app already knew which entries were unsupported — the
 * same tender's readiness payload named "disciplines[6], sectors[6]" as
 * inferred and said not to cite them — but the renderers printed the stored
 * array whole.
 *
 * A person's disciplines, the firm's capabilities and a project's service
 * areas are three different things. These tests pin the first: an expert is
 * presented only with what that expert's own source document supports.
 *
 * Sector-neutral by construction: the filter reads provenance, never
 * vocabulary, so the cases below are drawn from road, water and geotechnical
 * records as well as the building one that exposed the defect.
 */

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * Build an expert record whose stored provenance verifies exactly the element
 * indices given. Mirrors the shape buildPartialSourceVerificationProvenance
 * writes: a v1 payload whose `evidence` names the fields found in source.
 */
function expertWithVerifiedIndices(opts: {
  disciplines: string[];
  verifiedDisciplineIndices: number[];
  sectors?: string[];
  verifiedSectorIndices?: number[];
}): ReviewRecordState {
  const evidence = [
    { field: "fullName", value: "A. Person" },
    ...opts.verifiedDisciplineIndices.map((i) => ({ field: `disciplines[${i}]`, value: opts.disciplines[i] })),
    ...(opts.verifiedSectorIndices ?? []).map((i) => ({ field: `sectors[${i}]`, value: (opts.sectors ?? [])[i] })),
  ].map((item) => ({
    field: item.field,
    valueHash: sha256(String(item.value).toLowerCase()),
    quoteHash: sha256(String(item.value)),
    quote: String(item.value),
    page: 1,
    start: 0,
    end: String(item.value).length,
  }));

  return {
    trustLevel: "SOURCE_VERIFIED",
    fullName: "A. Person",
    disciplines: JSON.stringify(opts.disciplines),
    sectors: JSON.stringify(opts.sectors ?? []),
    certifications: JSON.stringify([]),
    reviewNotes: SOURCE_VERIFICATION_PROVENANCE_PREFIX + JSON.stringify(provenanceEnvelope(evidence)),
  } as unknown as ReviewRecordState;
}

/** The v1 payload shape parseStoredSourceVerification accepts. */
function provenanceEnvelope(evidence: unknown[]): Record<string, unknown> {
  return {
    version: 1,
    recordType: "EXPERT",
    sourceDocumentId: "doc-1",
    sourceContentHash: sha256("source-bytes"),
    sourceByteLength: 4096,
    sourceTextHash: sha256("source-text"),
    sourceExtractionRevision: "rev-1",
    verificationMethod: "DETERMINISTIC",
    verifiedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    evidence,
  };
}

test("an inferred discipline is not presented, whatever the sector", () => {
  const disciplines = [
    "Architecture",
    "Urban Planning",
    "Structural Engineering",
    "Civil Engineering",
    "Geotechnical Engineering",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Quantity Surveying",
  ];
  const record = expertWithVerifiedIndices({
    disciplines,
    verifiedDisciplineIndices: [0, 1, 2, 3, 4, 5],
  });
  assert.deepEqual(sourceVerifiedListElements(record, "disciplines"), disciplines.slice(0, 6));
});

test("the verified elements keep their stored order and exact bytes", () => {
  const disciplines = ["Highway Engineering", "Hydraulic / Water Resources", "Geotechnical Engineering"];
  const record = expertWithVerifiedIndices({ disciplines, verifiedDisciplineIndices: [0, 2] });
  assert.deepEqual(sourceVerifiedListElements(record, "disciplines"), [
    "Highway Engineering",
    "Geotechnical Engineering",
  ]);
});

test("verification is per element, not per list — a gap in the middle is honoured", () => {
  const disciplines = ["Road Design", "Pavement Engineering", "Bridge Engineering", "Traffic Engineering"];
  const record = expertWithVerifiedIndices({ disciplines, verifiedDisciplineIndices: [1, 3] });
  assert.deepEqual(sourceVerifiedListElements(record, "disciplines"), ["Pavement Engineering", "Traffic Engineering"]);
});

test("sectors are filtered by the same authority as disciplines", () => {
  const record = expertWithVerifiedIndices({
    disciplines: ["Water Engineering"],
    verifiedDisciplineIndices: [0],
    sectors: ["Water and Sanitation", "Healthcare", "Mining"],
    verifiedSectorIndices: [0],
  });
  assert.deepEqual(sourceVerifiedListElements(record, "sectors"), ["Water and Sanitation"]);
});

test("an expert with nothing verified presents nothing, rather than everything", () => {
  const record = expertWithVerifiedIndices({
    disciplines: ["Architecture", "Highway Engineering"],
    verifiedDisciplineIndices: [],
    sectors: ["Healthcare"],
    verifiedSectorIndices: [0],
  });
  // sectors[0] is verified, so the payload does carry per-element evidence and
  // the disciplines filter is meaningful: none of them survive.
  assert.deepEqual(sourceVerifiedListElements(record, "disciplines"), []);
  assert.deepEqual(sourceVerifiedListElements(record, "sectors"), ["Healthcare"]);
});

test("provenance predating per-element evidence is left alone, not blanked", () => {
  // Filtering an identity-only payload would erase every expert's disciplines
  // on every tender, which is a far worse failure than the one being fixed.
  const record = {
    trustLevel: "SOURCE_VERIFIED",
    fullName: "A. Person",
    disciplines: JSON.stringify(["Geotechnical Engineering", "Materials Engineering"]),
    sectors: JSON.stringify([]),
    certifications: JSON.stringify([]),
    reviewNotes: SOURCE_VERIFICATION_PROVENANCE_PREFIX + JSON.stringify(provenanceEnvelope([{
      field: "fullName",
      valueHash: sha256("a. person"),
      quoteHash: sha256("A. Person"),
      quote: "A. Person",
      page: 1,
      start: 0,
      end: 9,
    }])),
  } as unknown as ReviewRecordState;
  assert.deepEqual(sourceVerifiedListElements(record, "disciplines"), [
    "Geotechnical Engineering",
    "Materials Engineering",
  ]);
});

test("a record with no stored list presents nothing", () => {
  const record = { trustLevel: "SOURCE_VERIFIED", fullName: "A", disciplines: null, reviewNotes: null } as unknown as ReviewRecordState;
  assert.deepEqual(sourceVerifiedListElements(record, "disciplines"), []);
});

test("generation narrows the presented lists at the vault boundary", async () => {
  // Every renderer that prints an expert reads the record handed to it by
  // generate-elite. Narrowing there is what makes the twenty-odd print sites
  // correct without any of them knowing about provenance.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  assert.match(source, /sourceVerifiedListElements\(e, "disciplines"\)/);
  assert.match(source, /sourceVerifiedListElements\(e, "sectors"\)/);
  assert.match(source, /sourceVerifiedListElements\(e, "certifications"\)/);
});
