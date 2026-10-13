// A hospital's medical gas is building services, not the oil and gas sector.
// A real healthcare design tender ("coordinate mechanical, electrical,
// plumbing, medical gas, IT, telehealth, and healthcare facility engineering
// systems") was offered P&ID development, pipeline stress analysis (Caesar II)
// and cathodic-protection design (2026-10-06): "/gas.*facilit/" spanned the
// whole sentence. Oil and gas work is still recognised when the tender asks
// for it.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { detectThemes } from "../lib/engine/proposal-intelligence";

const codes = (text: string) => detectThemes(text).map((t) => t.code);

describe("oil and gas is recognised from the work, not from stray words", () => {
  it("a hospital's medical gas, toilets and feed lines are not oil and gas", () => {
    for (const text of [
      "The consultant shall coordinate mechanical, electrical, plumbing, medical gas, IT, telehealth, and healthcare facility engineering systems.",
      "Design of the medical-gas facility and the oxygen plant room for the hospital.",
      "Provide separate toilets for staff, with an accessible facility on each floor.",
      "Site inspection findings feed into the detailed design of the clinic.",
    ]) assert.ok(!codes(text).includes("OIL_GAS"), text);
  });

  it("a gas processing facility, a refinery or a HAZOP study is", () => {
    for (const text of [
      "Detailed design of a gas processing facility and its export pipeline.",
      "Brownfield upgrade of the refinery's crude distillation unit.",
      "Lead the HAZOP study and close out every action item.",
      "Prepare the FEED package for the compressor station.",
    ]) assert.ok(codes(text).includes("OIL_GAS"), text);
  });
});
