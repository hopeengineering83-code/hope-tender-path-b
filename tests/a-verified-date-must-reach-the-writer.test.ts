import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { projectProofLine, type ProjectLite } from "../lib/engine/proposal-intelligence";

/**
 * THE DEFECT, found by walking the chain the audit asks for:
 * source -> extracted fact -> structured field -> provenance -> matcher ->
 * selected evidence -> WRITER CONTEXT -> generated statement -> delivered bytes.
 *
 * It breaks at the writer.
 *
 * `projectProofLine` is the only thing that turns a Company Vault project into
 * a line the proposal writer can read. It took the client, country, sector and
 * contract value straight off the record's columns -- and then, for the
 * delivery window, called a helper whose own comment read:
 *
 *   // ProjectLite carries no date columns, so the record's own text is the
 *   // only source of a duration here.
 *
 * That was true of the TYPE and false of the DATA. Every caller passes a full
 * Project row loaded with `include`, and `Project.startDate` / `Project.endDate`
 * are populated and durably verified across the portfolio. The type narrowed
 * them away, so the duration was re-derived by regex from `summary` prose, and
 * a project whose summary did not happen to restate its years reached the
 * proposal with no delivery window at all -- while the verified answer sat
 * unread in the same object. The same record's `contractValue` was read
 * straight from its column two lines above, which is exactly the authority
 * class these dates belong to.
 *
 * These are pure input/output tests on the writer's own formatter. They are
 * not tied to any one tender, sector or benchmark record.
 */

function project(overrides: Partial<ProjectLite> = {}): ProjectLite {
  return {
    name: "Kombolcha Water Supply Rehabilitation",
    clientName: "Amhara Water Works Enterprise",
    country: "Ethiopia",
    sector: "Water Supply",
    serviceAreas: "[]",
    summary: "Detailed design and construction supervision of the town water supply scheme.",
    ...overrides,
  };
}

describe("a verified stored date reaches the writer", () => {
  it("prints the stored delivery window when the prose never states it", () => {
    // The exact case that silently lost content: verified columns present,
    // summary silent.
    const line = projectProofLine(project({ startDate: "2015-03-01", endDate: "2018-11-30" }));
    assert.match(line, /2015-2018/);
  });

  it("prints a single year when only one bound is stored", () => {
    assert.match(projectProofLine(project({ endDate: "2021-06-30" })), /\| 2021/);
    assert.match(projectProofLine(project({ startDate: "2019-01-04" })), /\| 2019/);
  });

  it("accepts Date objects as well as strings, because Prisma returns Date", () => {
    const line = projectProofLine(project({
      startDate: new Date("2012-01-01T00:00:00Z"),
      endDate: new Date("2014-12-31T00:00:00Z"),
    }));
    assert.match(line, /2012-2014/);
  });

  it("still derives from the record's own prose when no date is stored", () => {
    // The old behaviour is a fallback now, not the only path.
    const line = projectProofLine(project({
      summary: "Geotechnical investigation and foundation design delivered from 2017 to 2019 for the regional bureau.",
    }));
    assert.match(line, /2017-2019/);
  });
});

describe("a conflict is not resolved by preference", () => {
  it("emits no duration when the stored years and the prose disagree", () => {
    // One of the two is wrong and this function cannot tell which. A delivery
    // window printed in a client proposal is acted on, so silence is the safe
    // answer -- and the verified record is never edited to make them agree.
    const line = projectProofLine(project({
      startDate: "2016-01-01",
      endDate: "2019-12-31",
      summary: "Road upgrading works supervised from 2011 to 2013 for the roads authority.",
    }));
    assert.doesNotMatch(line, /2016-2019/);
    assert.doesNotMatch(line, /2011-2013/);
  });

  it("keeps the rest of the record when the duration is withheld", () => {
    // Failing closed on ONE field must not blank the line.
    const line = projectProofLine(project({
      startDate: "2016-01-01",
      endDate: "2019-12-31",
      summary: "Road upgrading works supervised from 2011 to 2013 for the roads authority.",
    }));
    assert.match(line, /Kombolcha Water Supply Rehabilitation/);
    assert.match(line, /Amhara Water Works Enterprise/);
  });

  it("agreeing sources are not a conflict", () => {
    const line = projectProofLine(project({
      startDate: "2017-02-01",
      endDate: "2019-08-31",
      summary: "Delivered from 2017 to 2019 for the regional bureau.",
    }));
    assert.match(line, /2017-2019/);
  });
});

describe("the stored date is read across sectors, not just one", () => {
  for (const [sector, name] of [
    ["Road Works", "Modjo-Hawassa Expressway Supervision"],
    ["Software and Services", "Utility Billing System Rollout"],
    ["Logistics", "Cold-Chain Distribution Hub Design"],
    ["Agriculture and Energy", "Afar Solar Mini-Grid Feasibility"],
    ["Building Consultancy", "Regional Referral Hospital Design"],
  ] as const) {
    it(`prints the window for a ${sector} record`, () => {
      const line = projectProofLine(project({
        name,
        sector,
        summary: "Full consultancy services delivered to the client's satisfaction.",
        startDate: "2020-01-01",
        endDate: "2023-01-01",
      }));
      assert.match(line, /2020-2023/, line);
    });
  }
});

describe("nothing invents a date", () => {
  it("prints no window when neither the columns nor the prose carry one", () => {
    const line = projectProofLine(project());
    assert.doesNotMatch(line, /\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/);
  });

  it("ignores an unparseable stored value rather than printing NaN", () => {
    const line = projectProofLine(project({ startDate: "not a date", endDate: "" }));
    assert.doesNotMatch(line, /NaN/);
  });
});
