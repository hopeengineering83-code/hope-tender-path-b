// Unit tests for mergeAnalysisResults (lib/ai.ts) and the JSON repair
// "largest balanced object" extraction path (analyzeOneChunk).
//
// mergeAnalysisResults is not exported, so we mirror its logic directly —
// the same pattern used in ai-analyze-chunked-sequential.test.ts. This keeps
// the tests pure (no DB, no network) while locking the exact merge invariants.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ─── Mirror of AIAnalysisResult shape ────────────────────────────────────────

type Requirement = {
  title?: string;
  description?: string;
  requirementType?: string;
  requiredQuantity?: number | null;
};

type AnalysisResult = {
  summary: string;
  requirements: Requirement[];
  exactFileNaming: string[];
  exactFileOrder: string[];
  evaluationMethodology: string;
  submissionNotes: string;
};

// ─── Mirror of mergeAnalysisResults (lib/ai.ts:991) ─────────────────────────

function mergeAnalysisResults(parts: AnalysisResult[]): AnalysisResult {
  if (parts.length === 0) throw new Error("mergeAnalysisResults: cannot merge zero analysis parts");
  if (parts.length === 1) return parts[0];

  const summary = parts.map((p) => p.summary ?? "").sort((a, b) => b.length - a.length)[0] ?? "";

  const reqByKey = new Map<string, Requirement>();
  for (const part of parts) {
    for (const req of part.requirements ?? []) {
      const key = (req.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!key) continue;
      const existing = reqByKey.get(key);
      if (!existing || (req.description?.length ?? 0) > (existing.description?.length ?? 0)) {
        reqByKey.set(key, req);
      }
    }
  }
  const requirements = [...reqByKey.values()];

  const seenNames = new Set<string>();
  const exactFileNaming: string[] = [];
  for (const part of parts) {
    for (const name of part.exactFileNaming ?? []) {
      const k = name.toLowerCase().trim();
      if (k && !seenNames.has(k)) { seenNames.add(k); exactFileNaming.push(name); }
    }
  }

  const seenOrder = new Set<string>();
  const exactFileOrder: string[] = [];
  for (const part of parts) {
    for (const name of part.exactFileOrder ?? []) {
      const k = name.toLowerCase().trim();
      if (k && !seenOrder.has(k)) { seenOrder.add(k); exactFileOrder.push(name); }
    }
  }

  const evaluationMethodology = parts.map((p) => (p.evaluationMethodology ?? "").trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("\n\n");
  const submissionNotes = parts.map((p) => (p.submissionNotes ?? "").trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("\n\n");

  return { summary, requirements, exactFileNaming, exactFileOrder, evaluationMethodology, submissionNotes };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return { summary: "", requirements: [], exactFileNaming: [], exactFileOrder: [], evaluationMethodology: "", submissionNotes: "", ...overrides };
}

// ─── mergeAnalysisResults — single part ──────────────────────────────────────

describe("mergeAnalysisResults — single chunk pass-through", () => {
  it("returns the single part unchanged", () => {
    const part = emptyResult({ summary: "only chunk", requirements: [{ title: "T1" }] });
    const merged = mergeAnalysisResults([part]);
    assert.equal(merged.summary, "only chunk");
    assert.equal(merged.requirements.length, 1);
  });
});

// ─── mergeAnalysisResults — summary selection ─────────────────────────────────

describe("mergeAnalysisResults — summary: longest non-empty wins", () => {
  it("picks the longest summary across chunks", () => {
    const parts = [
      emptyResult({ summary: "short" }),
      emptyResult({ summary: "a much longer and more informative summary from chunk 2" }),
      emptyResult({ summary: "medium length summary" }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.summary, "a much longer and more informative summary from chunk 2");
  });

  it("falls back to empty string when all summaries are empty", () => {
    const parts = [emptyResult(), emptyResult()];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.summary, "");
  });
});

// ─── mergeAnalysisResults — requirement deduplication ────────────────────────

describe("mergeAnalysisResults — requirements: dedup by normalised title", () => {
  it("deduplicates the same requirement appearing in two chunks", () => {
    const parts = [
      emptyResult({ requirements: [{ title: "Team Leader", description: "5 years" }] }),
      emptyResult({ requirements: [{ title: "Team Leader", description: "5 years experience" }] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.requirements.length, 1);
  });

  it("keeps the longer description when the same requirement is in two chunks", () => {
    const parts = [
      emptyResult({ requirements: [{ title: "Team Leader", description: "short desc" }] }),
      emptyResult({ requirements: [{ title: "Team Leader", description: "this is a much more detailed description with extra information" }] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.requirements[0].description, "this is a much more detailed description with extra information");
  });

  it("normalises title case and whitespace when deduplicating", () => {
    const parts = [
      emptyResult({ requirements: [{ title: "  Team  Leader  ", description: "from chunk 1" }] }),
      emptyResult({ requirements: [{ title: "team leader", description: "from chunk 2 with longer desc" }] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.requirements.length, 1);
    assert.equal(merged.requirements[0].description, "from chunk 2 with longer desc");
  });

  it("keeps distinct requirements from different chunks", () => {
    const parts = [
      emptyResult({ requirements: [{ title: "Team Leader" }, { title: "Financial Expert" }] }),
      emptyResult({ requirements: [{ title: "Environmental Expert" }] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.requirements.length, 3);
  });

  it("skips requirements with no title", () => {
    const parts = [
      emptyResult({ requirements: [{ title: "", description: "orphan" }, { title: "Real Req" }] }),
    ];
    const merged = mergeAnalysisResults([parts[0], emptyResult()]);
    const titles = merged.requirements.map((r) => r.title);
    assert.ok(!titles.includes(""), "empty-title requirement must be excluded");
    assert.ok(titles.includes("Real Req"));
  });
});

// ─── mergeAnalysisResults — file naming union ────────────────────────────────

describe("mergeAnalysisResults — exactFileNaming: union preserving first-seen order", () => {
  it("unions file names from both chunks, preserving insertion order", () => {
    const parts = [
      emptyResult({ exactFileNaming: ["Technical Proposal.pdf", "Company Profile.pdf"] }),
      emptyResult({ exactFileNaming: ["Financial Proposal.pdf", "Company Profile.pdf"] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.deepEqual(merged.exactFileNaming, ["Technical Proposal.pdf", "Company Profile.pdf", "Financial Proposal.pdf"]);
  });

  it("deduplicates case-insensitively", () => {
    const parts = [
      emptyResult({ exactFileNaming: ["Company Profile.pdf"] }),
      emptyResult({ exactFileNaming: ["company profile.pdf"] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.exactFileNaming.length, 1);
  });

  it("preserves original casing from first occurrence", () => {
    const parts = [
      emptyResult({ exactFileNaming: ["Technical Proposal.pdf"] }),
      emptyResult({ exactFileNaming: ["technical proposal.pdf"] }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.exactFileNaming[0], "Technical Proposal.pdf");
  });
});

// ─── mergeAnalysisResults — evaluation methodology concatenation ──────────────

describe("mergeAnalysisResults — evaluationMethodology: distinct chunks concatenated", () => {
  it("concatenates distinct evaluationMethodology strings with double newline", () => {
    const parts = [
      emptyResult({ evaluationMethodology: "Technical: 70%" }),
      emptyResult({ evaluationMethodology: "Financial: 30%" }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.evaluationMethodology, "Technical: 70%\n\nFinancial: 30%");
  });

  it("deduplicates identical evaluationMethodology strings", () => {
    const parts = [
      emptyResult({ evaluationMethodology: "Technical: 70%" }),
      emptyResult({ evaluationMethodology: "Technical: 70%" }),
    ];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.evaluationMethodology, "Technical: 70%");
  });

  it("ignores empty evaluationMethodology strings", () => {
    const parts = [emptyResult({ evaluationMethodology: "" }), emptyResult({ evaluationMethodology: "Score: pass/fail" })];
    const merged = mergeAnalysisResults(parts);
    assert.equal(merged.evaluationMethodology, "Score: pass/fail");
  });
});

// ─── mergeAnalysisResults — partial success (2 of 3 chunks succeed) ───────────

describe("mergeAnalysisResults — partial success (2/3 chunks)", () => {
  it("merges two successful chunks without data loss", () => {
    const chunk1 = emptyResult({
      summary: "Chunk 1 summary",
      requirements: [{ title: "Lead Expert", description: "10 years" }],
      exactFileNaming: ["Cover Letter.pdf"],
    });
    const chunk3 = emptyResult({
      summary: "Chunk 3 summary — longer and covers financial section",
      requirements: [{ title: "Financial Expert", description: "CPA certified" }],
      exactFileNaming: ["Financial Proposal.pdf"],
    });
    // chunk2 failed — only pass the two successful ones
    const merged = mergeAnalysisResults([chunk1, chunk3]);
    assert.equal(merged.summary, "Chunk 3 summary — longer and covers financial section");
    assert.equal(merged.requirements.length, 2);
    assert.equal(merged.exactFileNaming.length, 2);
  });
});

// ─── contactDetailsSource chunk merge — best wins (Phase 32 fix) ──────────────
// Earlier chunks may output null for keys found only in later chunks (e.g. donorAgency
// is on page 40 so chunk 0 returns { page: null, quote: null } but chunk 3 returns
// { page: 40, quote: "World Bank" }). The merge must prefer the real data over the null.

type DetailsSource = Record<string, { page: number | null; quote: string | null }>;

function mergeContactDetailsSource(parts: Array<DetailsSource | null | undefined>): DetailsSource {
  const merged: DetailsSource = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, val] of Object.entries(part)) {
      const existing = merged[key];
      const existingHasData = existing && (existing.page !== null || existing.quote !== null);
      const newHasData = val.page !== null || val.quote !== null;
      if (!existing || (!existingHasData && newHasData)) {
        merged[key] = val;
      }
    }
  }
  return merged;
}

describe("contactDetailsSource merge — best-wins logic", () => {
  it("keeps a real entry from a later chunk when an earlier chunk has null for the same key", () => {
    const chunk0: DetailsSource = {
      procuringEntityName: { page: 1, quote: "Ministry of Water" },
      donorAgency: { page: null, quote: null }, // not found in chunk 0
    };
    const chunk3: DetailsSource = {
      donorAgency: { page: 40, quote: "World Bank" }, // found in chunk 3
    };
    const merged = mergeContactDetailsSource([chunk0, chunk3]);
    assert.equal(merged.donorAgency.page, 40, "Later chunk's real donorAgency must win over null from chunk 0");
    assert.equal(merged.donorAgency.quote, "World Bank");
  });

  it("keeps first-chunk data when later chunk has null", () => {
    const chunk0: DetailsSource = { country: { page: 2, quote: "Ethiopia" } };
    const chunk3: DetailsSource = { country: { page: null, quote: null } };
    const merged = mergeContactDetailsSource([chunk0, chunk3]);
    assert.equal(merged.country.page, 2, "Real data from chunk 0 must not be overwritten by null from chunk 3");
  });

  it("keeps first real entry when both chunks have real data for the same key", () => {
    const chunk0: DetailsSource = { clientContactName: { page: 5, quote: "John Doe" } };
    const chunk2: DetailsSource = { clientContactName: { page: 22, quote: "Jane Smith" } };
    const merged = mergeContactDetailsSource([chunk0, chunk2]);
    assert.equal(merged.clientContactName.quote, "John Doe", "First real entry must not be replaced by a later real entry");
  });

  it("captures new keys introduced by later chunks", () => {
    const chunk0: DetailsSource = { procuringEntityName: { page: 1, quote: "GoE" } };
    const chunk2: DetailsSource = { implementingAgency: { page: 30, quote: "NPCU" } };
    const merged = mergeContactDetailsSource([chunk0, chunk2]);
    assert.ok("implementingAgency" in merged, "Keys first seen in later chunks must be included");
    assert.equal(merged.implementingAgency.quote, "NPCU");
  });

  it("preserves procurementReferenceNumber when provided by any chunk", () => {
    const chunk0: DetailsSource = { procuringEntityName: { page: 1, quote: "DoT" } };
    const chunk1: DetailsSource = { procurementReferenceNumber: { page: 3, quote: "RFP/DoT/2025/001" } };
    const merged = mergeContactDetailsSource([chunk0, chunk1]);
    assert.ok("procurementReferenceNumber" in merged);
    assert.equal(merged.procurementReferenceNumber.quote, "RFP/DoT/2025/001");
  });

  it("handles empty parts array gracefully", () => {
    const merged = mergeContactDetailsSource([]);
    assert.deepEqual(merged, {});
  });

  it("handles null/undefined parts without throwing", () => {
    const chunk0: DetailsSource = { country: { page: 1, quote: "Ethiopia" } };
    const merged = mergeContactDetailsSource([chunk0, null, undefined]);
    assert.equal(merged.country.quote, "Ethiopia");
  });
});

// ─── JSON repair: largest balanced-object extraction path ─────────────────────
// Mirrors the allMatches path in analyzeOneChunk (lib/ai.ts:1145–1149).
//
// The actual code:
//   1. Greedy match: /\{[\s\S]*\}/ — from first { to last }
//   2. tryParseAndSanitize(jsonMatch[0]) — try the whole span
//   3. allMatches = matchAll(/\{[\s\S]*?\}/g) sorted by length desc
//      — when the greedy span spans multiple {…} objects with junk between
//        them (which makes the whole span invalid), the non-greedy allMatches
//        finds each individual {…} object and tries the largest first.
//   4. trailing-comma repair on greedy match
//
// The "largest balanced object" path (step 3) fires when a provider emits
// a valid JSON object followed by extra junk or a second broken object —
// the greedy span fails, but the individual valid object is found via allMatches.

function repairAndExtract(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Step 1: greedy match (mirrors jsonMatch in analyzeOneChunk)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  function tryParse(raw: string): Record<string, unknown> | null {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
    } catch { return null; }
  }

  // Step 2: direct parse of greedy match
  const direct = tryParse(jsonMatch[0]);
  if (direct) return direct;

  // Step 3: allMatches — non-greedy, sorted by length desc (mirrors allMatches path)
  const allMatches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)].sort((a, b) => b[0].length - a[0].length);
  for (const m of allMatches) {
    const r = tryParse(m[0]);
    if (r) return r;
  }

  // Step 4: trailing-comma repair
  const repaired = jsonMatch[0].replace(/,(\s*[}\]])/g, "$1");
  if (repaired !== jsonMatch[0]) {
    const r = tryParse(repaired);
    if (r) return r;
  }
  return null;
}

describe("JSON repair — largest balanced object extraction (mirrors analyzeOneChunk allMatches path)", () => {
  it("extracts the valid leading object when trailing junk makes the greedy span invalid", () => {
    // Provider emitted a valid JSON object then extra text + another broken object.
    // Greedy match spans both → fails. allMatches finds the first valid object.
    const valid = JSON.stringify({ summary: "procurement of goods", requirements: [] });
    const raw = `${valid} EXTRA_GARBAGE {"broken": true}`;
    const result = repairAndExtract(raw);
    assert.ok(result, "should extract the valid object");
    assert.equal((result as { summary: string }).summary, "procurement of goods");
  });

  it("prefers the larger of two flat valid objects when the greedy span fails", () => {
    // Both objects are flat (no nesting) so non-greedy regex captures them correctly.
    // Greedy span from first { to last } spans both + junk between → invalid.
    // allMatches sorted by length descending finds the larger object first.
    const large = JSON.stringify({ summary: "detailed analysis", evaluationMethodology: "Technical 70%" });
    const small = JSON.stringify({ ok: true });
    const raw = `${large} GARBAGE ${small}`;
    const result = repairAndExtract(raw);
    assert.ok(result, "should extract a valid object");
    // The larger object (summary+evaluationMethodology) must win over the smaller {ok:true}
    assert.ok("summary" in result || "evaluationMethodology" in result, "expected the larger object fields");
  });

  it("extracts valid inner object via trailing-comma repair when allMatches fails", () => {
    // Only one {…} span exists but it has a trailing comma → repair path
    const raw = '{"summary": "ok", "requirements": [],}';
    const result = repairAndExtract(raw);
    assert.ok(result);
    assert.equal((result as { summary: string }).summary, "ok");
  });

  it("returns null when no valid JSON object exists anywhere in the text", () => {
    const result = repairAndExtract("no json here at all just plain text");
    assert.equal(result, null);
  });

  it("handles text with only an empty object", () => {
    const result = repairAndExtract("{}");
    assert.ok(result);
    assert.deepEqual(result, {});
  });
});
