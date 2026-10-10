// A.7 In-House Capabilities states only what the firm's records show.
//
// A hosted package delivered "Quality Management System — ISO 9001:2015-aligned
// QMS with documented design-review gates, document control, and audit
// trail" for a firm whose records name a "Quality Management System manual"
// and no ISO standard. In the same builder "ems" matched inside "systems" and
// printed an "ISO 14001-aligned EMS", and any mention of "employees" made
// every proposed expert "permanent staff, not sub-consultants". Fixtures are
// generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildInHouseCapabilitiesSection } from "../lib/engine/understanding-and-value-added";

function capabilities(evidenceLines: string[]): string {
  return buildInHouseCapabilitiesSection({ companyName: "Firm PLC", serviceLines: ["Architectural design"], sectors: ["Healthcare"], evidenceLines });
}

describe("in-house capabilities state only what the records show", () => {
  it("a quality management system manual is not an ISO certification", () => {
    const md = capabilities(["Quality Management System manual QM/01/23; 35 employees across two offices."]);
    assert.match(md, /Quality Management System\*\* — the firm's own quality management system/);
    assert.doesNotMatch(md, /ISO/);
    assert.doesNotMatch(md, /permanent/i);
  });

  it("\"systems\" is not an environmental management system", () => {
    const md = capabilities(["Document control systems and drawing registers."]);
    assert.doesNotMatch(md, /Environmental Management System|14001/);
  });

  it("states permanence only when the records do", () => {
    assert.match(capabilities(["All technical staff are permanent employees of the firm."]), /records describe its staff as permanent/);
  });
});
