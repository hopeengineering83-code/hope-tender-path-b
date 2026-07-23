import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DASHBOARD_NAV_GROUPS,
  flattenDashboardLinks,
  getActiveDashboardHref,
} from "../lib/dashboard-navigation";
import {
  SEMANTIC_ICON_ASSIGNMENTS,
  findIconCollisions,
} from "../lib/semantic-icon-registry";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Final overlap/dead-code/page consolidation acceptance tests", () => {
  describe("sidebar destination count", () => {
    it("has at most six primary sidebar destinations", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      assert.ok(allLinks.length <= 6);
    });

    it("every primary nav destination has a page.tsx", () => {
      for (const link of flattenDashboardLinks(DASHBOARD_NAV_GROUPS)) {
        readFileSync(join(process.cwd(), "app", link.href.replace(/^\//, ""), "page.tsx"));
      }
    });
  });

  describe("semantic icon registry", () => {
    it("has no icon collisions in the same surface", () => {
      const collisions = findIconCollisions();
      assert.deepEqual(collisions, [], collisions.join("; "));
    });

    it("every assignment has an accessible label", () => {
      for (const assignment of SEMANTIC_ICON_ASSIGNMENTS) {
        assert.ok(assignment.accessibleLabel.length > 0);
      }
    });
  });

  describe("tender page next-action ownership", () => {
    const tenderPage = read("app/dashboard/tenders/[id]/page.tsx");

    it("renders exactly one NextActionPanel", () => {
      assert.equal((tenderPage.match(/<NextActionPanel/g) ?? []).length, 1);
    });

    it("does not render a competing standalone download strip", () => {
      assert.ok(!tenderPage.includes("TenderDownloadActionsPanel"));
    });

    it("keeps all five workflow stages collapsed by default", () => {
      for (const number of [1, 2, 3, 4, 5]) {
        const tag = tenderPage.match(new RegExp(`<WorkflowStage number=\\{${number}\\}[^>]*>`))?.[0] ?? "";
        assert.ok(tag, `Stage ${number} must exist`);
        assert.doesNotMatch(tag, /\sopen(?:=|\s|>)/, `Stage ${number} must stay collapsed until selected`);
      }
    });

    it("keeps diagnostics collapsed and separate", () => {
      assert.match(tenderPage, /title="Diagnostics and audit"/);
      assert.doesNotMatch(tenderPage, /title="Diagnostics and audit"[^>]*defaultOpen/);
    });
  });

  describe("dashboard quick engine access removal", () => {
    it("does not render the Quick Engine Access panel", () => {
      assert.ok(!read("app/dashboard/page.tsx").includes("Quick Engine Access"));
    });
  });

  describe("workflow anchor targets", () => {
    it("all canonical primary selectors exist in an owning panel or stable workflow stage", () => {
      const registry = read("lib/tender-workflow-stages.ts");
      const targets = [...registry.matchAll(/targets:\s*\["#([^"]+)"/g)].map((match) => match[1]);
      const sources = [
        "components/tender-source-files-panel.tsx",
        "components/extraction-quality-dashboard.tsx",
        "components/ai-analyze-panel.tsx",
        "components/requirement-coverage-panel.tsx",
        "app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx",
        "components/submission-plan-truth-panel.tsx",
        "components/matching-quality-panel.tsx",
        "components/generation-action-panel.tsx",
        "components/authority-review-panel.tsx",
        "components/export-readiness-panel.tsx",
        "app/dashboard/tenders/[id]/page.tsx",
      ].map((file) => read(file)).join("\n");
      for (const id of targets) {
        assert.ok(sources.includes(`id="${id}"`) || sources.includes(`workflow-stage-${id.at(-1)}`), `Missing target #${id}`);
      }
    });
  });

  describe("route reachability", () => {
    it("all nav memberHrefs resolve to existing page.tsx", () => {
      for (const link of flattenDashboardLinks(DASHBOARD_NAV_GROUPS)) {
        for (const memberHref of link.memberHrefs ?? []) {
          readFileSync(join(process.cwd(), "app", memberHref.replace(/^\//, ""), "page.tsx"));
        }
      }
    });
  });

  describe("active state resolution", () => {
    it("resolves grouped routes to their primary destinations", () => {
      assert.equal(getActiveDashboardHref("/dashboard/analysis", DASHBOARD_NAV_GROUPS), "/dashboard/analysis");
      assert.equal(getActiveDashboardHref("/dashboard/matching", DASHBOARD_NAV_GROUPS), "/dashboard/analysis");
      assert.equal(getActiveDashboardHref("/dashboard/compliance", DASHBOARD_NAV_GROUPS), "/dashboard/analysis");
      assert.equal(getActiveDashboardHref("/dashboard/company/readiness", DASHBOARD_NAV_GROUPS), "/dashboard/company");
    });
  });
});
