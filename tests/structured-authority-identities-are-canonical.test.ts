/**
 * A structured authority states its own identities. Extraction verifies them;
 * it does not add to them.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real company authority export declares 28 experts and 114 projects and
 * carries each record's raw source text. The owner's real state is BOTH: the
 * structured import for identity, and the uploaded originals for provenance —
 * plan-b-import keeps its synthetic artifacts in PlanBStaging and links records
 * only to official uploads, so without those uploads the imported records stay
 * AI_DRAFT and never become generation-eligible.
 *
 * In exactly that configuration the deterministic extractor also ran across the
 * uploaded text and CREATED records beside the canonical ones. The same run
 * stored 35 experts and 177 projects, and the extras were not people or
 * projects at all:
 *
 *   "Dr Abdul Seid"     — a CLIENT, who owns a hospital named in a project row
 *   "Addis Ababa"       — a place, lifted from a "Loc:" line above a role
 *   "Asamenew Alye"     — a partial alias of "Asamenew Alye Mohammed"
 *
 * Auto-verification then promoted every one of them to SOURCE_VERIFIED,
 * because their text genuinely does appear in the owned source bytes. That is
 * the dangerous part: automatic matching could put a client or a city forward
 * as proposed staff, with provenance that looks valid.
 *
 * The rule is therefore about IDENTITY, not text: a company that carries
 * structured-authority staging rows is verify-and-enrich only. Ordinary
 * unstructured uploads are untouched — full extraction is exactly what they
 * need, and the second describe block pins that.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";

const INGESTION = readFileSync(path.join(process.cwd(), "lib/company-vault-ingestion.ts"), "utf8");
const SAFETY = readFileSync(path.join(process.cwd(), "lib/company-knowledge-safety-import.ts"), "utf8");

describe("the durable ingestion path refuses to mint identities over a structured authority", () => {
  it("counts structured-authority staging rows before persisting", () => {
    assert.match(
      INGESTION,
      /planBStaging\.count\(\s*\{\s*where:\s*\{\s*companyId\s*\}/,
      "the ingestion path must ask whether this company has a structured authority",
    );
  });

  it("passes allowNewIdentities based on that answer", () => {
    assert.match(
      INGESTION,
      /allowNewIdentities:\s*structuredAuthorityRows === 0/,
      "creation must be disabled exactly when a structured authority is present",
    );
  });

  it("applies the same rule on the safety-import entry point", () => {
    // Two entry points reach the same persistence. A rule applied to only one
    // of them is a rule that a future caller silently bypasses — which is how
    // this defect survived the first fix attempt.
    assert.match(SAFETY, /planBStaging\.count\(/);
    assert.match(SAFETY, /allowNewIdentities:\s*structuredAuthorityRows === 0/);
  });
});

describe("the guard blocks creation only, never verification or enrichment", () => {
  it("still updates existing records when new identities are disallowed", () => {
    // Verification is how canonical records earn SOURCE_VERIFIED provenance
    // from the uploaded originals. Blocking updates would leave the whole
    // vault ineligible for generation — a worse failure than the one fixed.
    const persist = SAFETY.slice(SAFETY.indexOf("async function persistOnce"));
    const expertUpdate = persist.indexOf("tx.expert.update");
    const expertGuard = persist.indexOf("if (!allowNewIdentities) continue;");
    assert.ok(expertUpdate > 0 && expertGuard > 0, "both the update and the guard must exist");
    assert.ok(expertUpdate < expertGuard, "the guard must sit on the create path, after the update path");
  });

  it("guards both the expert and the project create paths", () => {
    const persist = SAFETY.slice(SAFETY.indexOf("async function persistOnce"));
    assert.equal(
      persist.split("if (!allowNewIdentities) continue;").length - 1,
      2,
      "experts and projects must both be guarded",
    );
  });

  it("defaults to allowing creation, so unstructured uploads are unaffected", () => {
    // The heuristic extractor exists for ordinary uploads. A default that
    // silently suppressed creation would make every plain vault look empty.
    assert.match(
      SAFETY,
      /allowNewIdentities = options\.allowNewIdentities !== false/,
      "creation must remain the default when no option is supplied",
    );
  });
});
