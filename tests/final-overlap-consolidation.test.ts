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

  // ─── H.1: Maximum six primary sidebar destinations ─────────────────────
  describe("sidebar destination count", () => {
    it("has at most six primary sidebar destinations", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      assert.ok(
        allLinks.length <= 6,
        `Expected at most 6 primary sidebar destinations, found ${allLinks.length}: ` +
        allLinks.map((l) => l.href).join(", ")
      );
    });

    it("every primary nav destination has a page.tsx", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      for (const link of allLinks) {
        const pagePath = join("app", link.href.replace(/^\//, ""), "page.tsx");
        // This will throw if the file doesn't exist
        readFileSync(join(process.cwd(), pagePath));
      }
    });
  });

  // ─── H.2: No duplicate semantic icons in the same surface ─────────────
  describe("semantic icon registry", () => {
    it("has no icon collisions in the same surface", () => {
      const collisions = findIconCollisions();
      assert.deepEqual(collisions, [], collisions.join("; "));
    });

    it("every assignment has an accessible label", () => {
      for (const a of SEMANTIC_ICON_ASSIGNMENTS) {
        assert.ok(a.accessibleLabel.length > 0, `Missing accessibleLabel for ${a.meaning}`);
      }
    });
  });

  // ─── H.3: One general next action on the tender page ───────────────────
  describe("tender page next-action ownership", () => {
    const tenderPage = read("app/dashboard/tenders/[id]/page.tsx");

    it("renders exactly one NextActionPanel", () => {
      const matches = tenderPage.match(/<NextActionPanel/g) ?? [];
      assert.equal(matches.length, 1, "Tender page must render exactly one NextActionPanel");
    });

    it("does not render a competing standalone download strip", () => {
      assert.ok(
        !tenderPage.includes("TenderDownloadActionsPanel"),
        "TenderDownloadActionsPanel was removed — downloads live in Stage 5 and Document Archive"
      );
    });

    it("Stages 2-5 are collapsed by default (open={false} or no open prop)", () => {
      // Stage 1 must be open, Stages 2-5 must not be open
      const stage1Match = tenderPage.match(/WorkflowStage number={1}[^>]*open/);
      assert.ok(stage1Match, "Stage 1 must be open by default");
      // Stages 2-5 should not have open prop
      for (const n of [2, 3, 4, 5]) {
        const stageMatch = tenderPage.match(new RegExp(`WorkflowStage number={${n}}[^>]*(open)`));
        assert.ok(!stageMatch, `Stage ${n} must not be open by default`);
      }
    });

    it("Advanced diagnostics section is collapsed by default", () => {
      // The Advanced diagnostics Disclosure must not have defaultOpen={true}
      const advMatch = tenderPage.match(/Advanced diagnostics[\s\S]*?defaultOpen/);
      assert.ok(!advMatch || !advMatch[0].includes("defaultOpen={true}"),
        "Advanced diagnostics must be collapsed by default");
    });
  });

  // ─── H.4: Dashboard no longer has Quick Engine Access panel ────────────
  describe("dashboard quick engine access removal", () => {
    const dashboardPage = read("app/dashboard/page.tsx");

    it("does not render the Quick Engine Access panel", () => {
      assert.ok(
        !dashboardPage.includes("Quick Engine Access"),
        "Dashboard must not have the Quick Engine Access panel — it duplicates primary navigation"
      );
    });
  });

  // ─── H.5: All workflow links reach visible targets ─────────────────────
  describe("workflow anchor targets", () => {
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
        "components/authority-review-truth-panel.tsx",
        "components/authority-review-panel.tsx",
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

  // ─── H.6: No orphan routes ─────────────────────────────────────────────
  describe("route reachability", () => {
    it("all nav memberHrefs resolve to existing page.tsx", () => {
      const allLinks = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
      for (const link of allLinks) {
        for (const memberHref of link.memberHrefs ?? []) {
          const pagePath = join("app", memberHref.replace(/^\//, ""), "page.tsx");
          readFileSync(join(process.cwd(), pagePath));
        }
      }
    });
  });

  // ─── H.7: Active state correctness ─────────────────────────────────────
  describe("active state resolution", () => {
    it("/dashboard/analysis resolves to Engine nav item", () => {
      const active = getActiveDashboardHref("/dashboard/analysis", DASHBOARD_NAV_GROUPS);
      assert.equal(active, "/dashboard/analysis");
    });

    it("/dashboard/matching resolves to Engine nav item via memberHrefs", () => {
      const active = getActiveDashboardHref("/dashboard/matching", DASHBOARD_NAV_GROUPS);
      assert.equal(active, "/dashboard/analysis");
    });

    it("/dashboard/compliance resolves to Engine nav item via memberHrefs", () => {
      const active = getActiveDashboardHref("/dashboard/compliance", DASHBOARD_NAV_GROUPS);
      assert.equal(active, "/dashboard/analysis");
    });

    it("/dashboard/company/readiness resolves to Company Vault nav item", () => {
      const active = getActiveDashboardHref("/dashboard/company/readiness", DASHBOARD_NAV_GROUPS);
      assert.equal(active, "/dashboard/company");
    });
  });
});
