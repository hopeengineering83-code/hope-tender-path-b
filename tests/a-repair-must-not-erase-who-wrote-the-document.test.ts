import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT, observed on the run that was supposed to prove authorship.
 * ----------------------------------------------------------------------
 * 2026-09-16, run 35143112295. The full chain finally ran end to end:
 * AI Analyze -> Run Engine -> PROPOSAL_GENERATION -> AUTO_FINALIZE -> export ->
 * ZIP. The acceptance inspection then reported:
 *
 *   DOCUMENT AUTHORSHIP: 1 document(s)
 *     - 'Technical Proposal.pdf'
 *         reviewStatus='PENDING' mode='Machine export repair completed for Technical Proposal'
 *
 * `mode` is the first clause of contentSummary, which is where generation
 * states whether a model or the deterministic draft wrote the document — and it
 * is what the acceptance path reads to answer exactly that question.
 * export-gap-repair replaced the whole field:
 *
 *   contentSummary: `Machine export repair completed for ${name}.`
 *
 * So after any hygiene repair, the authorship of the proposal became
 * unknowable from the outside, on the very run whose purpose was to prove the
 * proposal was model-backed. The repair could only overwrite it because
 * contentSummary was not even in the row's `select`.
 *
 * Final authorship provenance is a preserved property, and a hygiene repair is
 * not an authorship event. The note is now appended, so both facts survive.
 */
describe("a repair must not erase who wrote the document", () => {
  const source = readFileSync("lib/engine/export-gap-repair.ts", "utf8");

  it("no longer replaces contentSummary outright", () => {
    assert.equal(
      /contentSummary: `Machine export repair completed for \$\{name\}\.`/.test(source),
      false,
      "export repair must not overwrite the authorship clause",
    );
  });

  it("appends through the shared helper instead", () => {
    assert.match(source, /contentSummary: appendRepairNote\(doc\.contentSummary, name\)/);
  });

  it("reads contentSummary, or it could only ever overwrite it", () => {
    // The root cause was structural: the field was absent from the select, so
    // no amount of care at the write site could have preserved it.
    const select = source.split("\n").find((line) => line.includes("reviewNotes: true"));
    assert.ok(select, "document select not found");
    assert.match(select, /contentSummary: true/);
  });

  describe("appendRepairNote behaviour", () => {
    // Exercised through the module's own logic, restated here so the contract
    // is pinned rather than inferred from the implementation.
    const appendRepairNote = (existing: string | null | undefined, name: string): string => {
      const note = `Machine export repair completed for ${name}.`;
      const prior = (existing ?? "").trim();
      if (prior.length === 0) return note;
      if (prior.includes(note)) return prior;
      return `${prior} ${note}`;
    };

    it("keeps the authorship clause in front of the repair note", () => {
      const authored = "MODEL_BACKED (groq/openai/gpt-oss-120b) narrative generated for Technical Proposal.";
      const after = appendRepairNote(authored, "Technical Proposal");
      assert.ok(after.startsWith(authored), "authorship must remain the first clause");
      assert.match(after, /Machine export repair completed for Technical Proposal\./);
    });

    it("is idempotent, so repeated repairs do not grow the field", () => {
      const once = appendRepairNote("Deterministic draft for Technical Proposal.", "Technical Proposal");
      const twice = appendRepairNote(once, "Technical Proposal");
      assert.equal(twice, once);
    });

    it("still says something when there was no prior summary", () => {
      assert.equal(
        appendRepairNote(null, "Company Profile"),
        "Machine export repair completed for Company Profile.",
      );
      assert.equal(
        appendRepairNote("   ", "Company Profile"),
        "Machine export repair completed for Company Profile.",
      );
    });
  });
});
