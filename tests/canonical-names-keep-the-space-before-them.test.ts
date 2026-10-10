// Canonical expert-name normalisation never eats the space before a name.
//
// enforceCanonicalNames runs on the AI writer's output only. Its pattern was
// "\b(?:Dr\.?|…)?\s*First …Last\b": with no title the "\s*" still matched,
// and after a word "\b" holds at the word's end, so "led by A. Name" matched
// " A. Name", was not the canonical form, and was replaced without its
// space. A hosted proposal printed "led byAhmed …", "andHabib …" across its
// Cover Letter and Executive Summary. Names below are invented.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { enforceCanonicalNames } from "../lib/engine/entity-name-normalizer";

const EXPERTS = [{ fullName: "Selam Bekele Tadesse" }, { fullName: "Dr. Yonas Alemu" }, { fullName: "Hana Girma" }];

describe("enforceCanonicalNames", () => {
  it("keeps the space before a name that follows a word", () => {
    const text = "The team is led by Selam Bekele Tadesse, supported by Hana Girma and Yonas Alemu.";
    assert.equal(
      enforceCanonicalNames(text, EXPERTS, []),
      "The team is led by Selam Bekele Tadesse, supported by Hana Girma and Dr. Yonas Alemu.",
    );
  });

  it("still restores the canonical form of a variant", () => {
    assert.equal(enforceCanonicalNames("Led by Eng. Hana Girma.", EXPERTS, []), "Led by Hana Girma.");
    assert.equal(enforceCanonicalNames("Led by Selam Tadesse.", EXPERTS, []), "Led by Selam Bekele Tadesse.");
    assert.equal(enforceCanonicalNames("Led by Dr. Yonas Alemu.", EXPERTS, []), "Led by Dr. Yonas Alemu.");
  });

  it("changes nothing in text that already names everyone canonically", () => {
    const text = "Selam Bekele Tadesse leads design and Hana Girma leads supervision, with Dr. Yonas Alemu.";
    assert.equal(enforceCanonicalNames(text, EXPERTS, []), text);
  });
});
