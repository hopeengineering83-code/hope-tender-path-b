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

describe("100% competing-icons / dead-code / interlinking acceptance tests", () => {

  describe("A. No competing icons", () => {
    it("semantic icon registry has no collisions", () => {
      const collisions = findIconCollisions();
      assert.deepEqual(collisions, [], collisions.join("; "));
    });

    it("every icon assignment has an accessible label", () => {
      for (const a of SEMANTIC_ICON_ASSIGNMENTS) {
        assert.ok(a.accessibleLabel.length > 0, `Missing accessibleLabel for ${a.meaning}`);
      }
    });
  });

  describe("B. No dead code", () => {
    it("TenderBreadcrumb is deleted (no dead component)", () => {
      let exists = true;
      try { read("components/tender-breadcrumb.tsx"); } catch { exists = false; }
      assert.ok(!exists, "components/tender-breadcrumb.tsx must be deleted — it was dead code");
    });

    it("tender detail page does not render TenderDownloadActionsPanel", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      assert.ok(
        !page.includes("TenderDownloadActionsPanel"),
        "TenderDownloadActionsPanel must not be rendered — downloads live in Stage 5 only"
      );
    });

    it("dashboard does not have Quick Engine Access panel", () => {
      const page = read("app/dashboard/page.tsx");
      assert.ok(
        !page.includes("Quick Engine Access"),
        "Quick Engine Access panel must be removed — it duplicates primary navigation"
      );
    });
  });

  describe("C. No broken interlinking", () => {
    it("command center uses DisclosureAwareLink for hash anchors", () => {
      const page = read("app/dashboard/tenders/[id]/command-center/page.tsx");
      // The "Open tender workspace" link must use DisclosureAwareLink, not plain <a>
      assert.ok(
        page.includes("DisclosureAwareLink"),
        "Command center must use DisclosureAwareLink for cross-page hash anchors"
      );
      // Must NOT have plain <a href={nextAction.href}> (the old broken pattern)
      assert.ok(
        !page.includes('<a\n              href={nextAction.href}'),
        "Command center must not use plain <a> for nextAction links"
      );
    });

    it("all TENDER_WORKFLOW_STAGE_TARGETS selectors exist in components", () => {
      const targets = read("lib/tender-workflow-stage-targets.ts");
      const selectorMatches = targets.matchAll(/"#([^"]+)"/g);
      const componentFiles = [
        "components/tender-source-files-panel.tsx",
        "components/extraction-quality-dashboard.tsx",
        "components/ai-analyze-panel.tsx",
        "components/requirement-coverage-panel.tsx",
        "app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx",
        "components/submission-plan-truth-panel.tsx",
        "components/matching-quality-panel.tsx",
        "components/generation-action-panel.tsx",
        "components/authority-review-panel.tsx",
        "components/authority-review-truth-panel.tsx",
        "components/export-readiness-panel.tsx",
        "components/final-package-manifest-panel.tsx",
        "components/submission-plan-reconciliation-panel.tsx",
      ];
      const allSource = componentFiles
        .map((f) => { try { return read(f); } catch { return ""; } })
        .join("\n");

      for (const m of selectorMatches) {
        const id = m[1];
        assert.ok(
          allSource.includes(`id="${id}"`),
          `Stage target #${id} not found in any component`
        );
      }
    });
  });

  describe("D. Single ownership", () => {
    it("tender page renders exactly one NextActionPanel", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      const matches = page.match(/<NextActionPanel/g) ?? [];
      assert.equal(matches.length, 1, "Tender page must render exactly one NextActionPanel");
    });

    it("tender page has exactly one download owner (Stage 5, no standalone strip)", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      assert.ok(
        !page.includes("TenderDownloadActionsPanel"),
        "No standalone download strip — downloads live in Stage 5 only"
      );
    });
  });

  describe("E. Nav consolidation", () => {
    it("has at most six primary sidebar destinations", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      assert.ok(
        allLinks.length <= 6,
        `Expected at most 6 primary sidebar destinations, found ${allLinks.length}`
      );
    });

    it("all nav destinations have a page.tsx", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      for (const link of allLinks) {
        const pagePath = join("app", link.href.replace(/^\//, ""), "page.tsx");
        readFileSync(join(process.cwd(), pagePath));
      }
    });

    it("all memberHrefs resolve to existing pages", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      for (const link of allLinks) {
        for (const memberHref of link.memberHrefs ?? []) {
          const pagePath = join("app", memberHref.replace(/^\//, ""), "page.tsx");
          readFileSync(join(process.cwd(), pagePath));
        }
      }
    });

    it("active state resolves correctly for consolidated routes", () => {
      assert.equal(getActiveDashboardHref("/dashboard/matching", DASHBOARD_NAV_GROUPS), "/dashboard/analysis");
      assert.equal(getActiveDashboardHref("/dashboard/compliance", DASHBOARD_NAV_GROUPS), "/dashboard/analysis");
      assert.equal(getActiveDashboardHref("/dashboard/company/readiness", DASHBOARD_NAV_GROUPS), "/dashboard/company");
    });
  });

  describe("F. Page structure", () => {
    it("tender page Stages 2-5 are collapsed by default", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      assert.ok(page.match(/WorkflowStage number={1}[^>]*open/), "Stage 1 must be open");
      for (const n of [2, 3, 4, 5]) {
        assert.ok(
          !page.match(new RegExp(`WorkflowStage number={${n}}[^>]*(open)`)),
          `Stage ${n} must not be open by default`
        );
      }
    });

    it("Advanced diagnostics is collapsed by default", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      const advMatch = page.match(/Advanced diagnostics[\s\S]*?defaultOpen/);
      assert.ok(!advMatch || !advMatch[0].includes("defaultOpen={true}"),
        "Advanced diagnostics must be collapsed by default");
    });
  });
});
