// Label-echo contamination — observed live on the preview deployment's
// Live Pipeline: a stored clientName of
//   "Pharo Ventures Procuring Entity / Client Name: Pharo Ventures Legal
//    Client Name: Pharo Ventures Project Name: Pharo Health..."
// (several extracted fields concatenated with their labels) rendered
// verbatim as the tender's client subtitle. A real organization name never
// contains field labels like "Client Name:" — the detector must classify
// such values as contaminated, and the dashboard must not echo them.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  isClientNameContaminated,
  clientNameContaminationReason,
} from "../lib/engine/metadata-validators";

describe("label-echo client-name contamination", () => {
  const observed =
    "Pharo Ventures Procuring Entity / Client Name: Pharo Ventures Legal Client Name: Pharo Ventures Project Name: Pharo Health Ethiopia Specialty Medical Center";

  it("flags the observed concatenated-labels value as contaminated", () => {
    assert.equal(isClientNameContaminated(observed), true);
    assert.match(clientNameContaminationReason(observed) ?? "", /embedded field labels/);
  });

  it("flags single embedded labels too", () => {
    assert.equal(isClientNameContaminated("Client Name: Pharo Ventures"), true);
    assert.equal(isClientNameContaminated("Acme Corp Project Name: Bridge Rehab"), true);
    assert.equal(isClientNameContaminated("Contact Person: Abebe K."), true);
  });

  it("does not flag legitimate organization names", () => {
    for (const legit of [
      "Pharo Ventures",
      "Ministry of Health & Tender Division",
      "Ministry of Water and Energy",
      "Hope Urban Planning Architectural and Engineering Consultancy PLC",
      "Addis Ababa City Administration",
    ]) {
      assert.equal(isClientNameContaminated(legit), false, `${legit} must not be flagged`);
    }
  });
});

describe("dashboard Live Pipeline presentation contract", () => {
  const src = readFileSync("app/dashboard/page.tsx", "utf8");

  it("client subtitle is contamination-aware instead of echoing polluted values", () => {
    assert.match(src, /isClientNameContaminated\(tender\.clientName\)/);
    assert.match(src, /Client name needs review/);
  });

  it("the pipeline caption pluralizes correctly and drops the malformed 'NOT canonical Clear' text", () => {
    assert.doesNotMatch(src, /NOT canonical Clear/);
    assert.match(src, /tender\{recentTenders\.length === 1 \? "" : "s"\}/);
  });
});
