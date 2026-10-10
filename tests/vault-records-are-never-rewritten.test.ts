// Generation must never rewrite a vault record's field values.
//
// WHAT HAPPENED
// -------------
// One reviewed project's country is stored with a trailing comma ("Gimba City,
// South Wollo Zone, Amhara Region,"), and about a dozen producers interpolate
// it straight into client-facing prose — so a delivered proposal read
// "(… Amhara Region,)". A commit tidied that comma away once, centrally, where
// the reviewed records enter the generation context.
//
// PROPOSAL_GENERATION then failed in about a second on every hosted run, and
// the acceptance harness reported those runs as fully green because a FAILED
// job is terminal and the old, still-valid document kept satisfying every
// downstream gate.
//
// WHY
// ---
// These records are source-verified. provenanceMatchesCurrentRecord() hashes
// each verified field's value and requires it to still equal what was verified
// against the source document — "Every verified field must still hold the value
// that was verified." Change one character and isDurablySourceVerified() goes
// false, canUseVaultRecord(record, "GENERATION") rejects the record, every
// project drops out, and the zero-evidence hard block throws. The gate was
// working exactly as designed; the edit was the defect.
//
// Punctuation is a rendering concern. It belongs at the point of display.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("generation does not mutate source-verified vault records", () => {
  it("takes the reviewed experts and projects exactly as stored", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

    assert.match(
      code,
      /const allSelectedExperts = tender\.expertMatches\.map\(\(m\) => m\.expert\);/,
      "expert records must reach generation unmodified",
    );
    assert.match(
      code,
      /const allSelectedProjects = tender\.projectMatches\.map\(\(m\) => m\.project\);/,
      "project records must reach generation unmodified",
    );
    assert.doesNotMatch(
      code,
      /tidyVaultText/,
      "no normalisation pass may sit between the vault records and generation",
    );
  });

  it("keeps a record usable when its stored punctuation is left alone", async () => {
    // The concrete shape of the failure: the same record, before and after the
    // kind of tidy-up that broke it.
    const { default: crypto } = await import("node:crypto");
    const stored = "Gimba City, South Wollo Zone, Amhara Region,";
    const tidied = stored.replace(/[\s,;:|/–—-]+$/, "");
    const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

    assert.notEqual(stored, tidied, "the tidy-up really does change the value");
    assert.notEqual(
      hash(stored),
      hash(tidied),
      "so it changes the value hash the provenance check compares, which is why "
      + "the record stopped being usable and generation hard-blocked",
    );
  });

  it("trims vault punctuation at the point of display instead", () => {
    // Every producer that wraps a vault value in brackets has to trim it for
    // display, because it cannot trim it on the record.
    for (const path of [
      "lib/engine/evidence-marker-injector.ts",
      "lib/engine/narrative-throughline-enforcer.ts",
      "lib/engine/section-c-depth-amplifier.ts",
      "lib/engine/benchmark-tables.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(
        source,
        /inlineEvidenceValue|cleanedParts/,
        `${path} must trim vault values for display rather than shipping their raw punctuation`,
      );
    }
  });
});
