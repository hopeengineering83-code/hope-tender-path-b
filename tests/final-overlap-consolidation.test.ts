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

    it("opens intake only and keeps downstream stages collapsed", () => {
      const first = tenderPage.match(/<WorkflowStage number=\{1\}[^>]*>/)?.[0] ?? "";
      assert.match(first, /\sopen(?:=|\s|>)/, "Stage 1 intake may remain visible as the working context");
      for (const number of [2, 3, 4, 5]) {
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

  // BidStrategyPanel (PR #249) shipped with a full server-side Bid/No-Bid
  // Decision Engine and its own gated API route, but nothing ever mounted the
  // component — the entire feature was invisible. Wired into Stage 2, after
  // requirement coverage and before Generate Docs, per the panel's own intent.
  describe("bid strategy decision support is wired into the workspace", () => {
    const tenderPage = read("app/dashboard/tenders/[id]/page.tsx");

    it("renders exactly one BidStrategyPanel", () => {
      assert.equal((tenderPage.match(/<BidStrategyPanel/g) ?? []).length, 1);
    });

    it("mounts it in Stage 2, after requirement coverage and before the AI diagnostics disclosure", () => {
      const stage2Start = tenderPage.indexOf('<WorkflowStage number={2}');
      const stage3Start = tenderPage.indexOf('<WorkflowStage number={3}');
      assert.ok(stage2Start > -1 && stage3Start > stage2Start, "Stage 2 must exist and precede Stage 3");
      const stage2 = tenderPage.slice(stage2Start, stage3Start);
      const coverageIndex = stage2.indexOf("<RequirementCoveragePanel");
      const strategyIndex = stage2.indexOf("<BidStrategyPanel");
      const diagnosticsDisclosureIndex = stage2.indexOf('title="AI diagnostics and assistance"');
      assert.ok(coverageIndex > -1, "RequirementCoveragePanel must exist in Stage 2");
      assert.ok(strategyIndex > coverageIndex, "BidStrategyPanel must come after requirement coverage");
      assert.ok(diagnosticsDisclosureIndex > strategyIndex, "BidStrategyPanel must come before the AI diagnostics disclosure");
    });

    it("is not hidden inside a collapsed Disclosure — it renders directly in the stage", () => {
      const strategyIndex = tenderPage.indexOf("<BidStrategyPanel");
      const precedingDisclosureClose = tenderPage.lastIndexOf("</Disclosure>", strategyIndex);
      const precedingDisclosureOpen = tenderPage.lastIndexOf("<Disclosure", strategyIndex);
      // If a <Disclosure were still open at this point, its most recent open
      // tag would come after its most recent close tag.
      assert.ok(
        precedingDisclosureOpen < precedingDisclosureClose,
        "BidStrategyPanel must not be nested inside a collapsed Disclosure",
      );
    });
  });

  describe("matching has one automatic read-only authority", () => {
    const tenderPage = read("app/dashboard/tenders/[id]/page.tsx");

    it("renders exactly one MatchingSelectedEvidencePanel", () => {
      assert.equal((tenderPage.match(/<MatchingSelectedEvidencePanel/g) ?? []).length, 1);
    });

    it("mounts it in Stage 3 without competing panels or rematch controls", () => {
      const stage3Start = tenderPage.indexOf('<WorkflowStage number={3}');
      const stage4Start = tenderPage.indexOf('<WorkflowStage number={4}');
      assert.ok(stage3Start > -1 && stage4Start > stage3Start, "Stage 3 must exist and precede Stage 4");
      const stage3 = tenderPage.slice(stage3Start, stage4Start);
      assert.match(stage3, /<MatchingSelectedEvidencePanel/);
      assert.doesNotMatch(stage3, /MatchingQualityPanel|ScoreBreakdownPanel|AIRematchButton|SelectionApprovalPanel/);
    });
  });

  // TenderControlsPanel (addenda, clarifications, questions, milestones,
  // tasks, risks, commercial assumptions — 681 lines, backed by a real gated
  // API route) was built but never mounted anywhere. Wired into Stage 1 as a
  // collapsed Disclosure, consistent with how this page tucks secondary
  // tracking tools behind a Disclosure rather than showing them by default.
  describe("tender controls tracking is wired into the workspace", () => {
    const tenderPage = read("app/dashboard/tenders/[id]/page.tsx");

    it("renders exactly one TenderControlsPanel", () => {
      assert.equal((tenderPage.match(/<TenderControlsPanel/g) ?? []).length, 1);
    });

    it("mounts it in Stage 1, inside a Disclosure", () => {
      const stage1Start = tenderPage.indexOf('<WorkflowStage number={1}');
      const stage2Start = tenderPage.indexOf('<WorkflowStage number={2}');
      assert.ok(stage1Start > -1 && stage2Start > stage1Start, "Stage 1 must exist and precede Stage 2");
      const stage1 = tenderPage.slice(stage1Start, stage2Start);
      const controlsIndex = stage1.indexOf("<TenderControlsPanel");
      assert.ok(controlsIndex > -1, "TenderControlsPanel must be mounted in Stage 1");
      const precedingDisclosureOpen = stage1.lastIndexOf("<Disclosure", controlsIndex);
      const precedingDisclosureClose = stage1.lastIndexOf("</Disclosure>", controlsIndex);
      assert.ok(
        precedingDisclosureOpen > precedingDisclosureClose,
        "TenderControlsPanel must be inside an open Disclosure tag at this point in the source",
      );
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
        // extraction-quality-dashboard.tsx was deleted as unrendered dead
        // code; its id="extraction-quality" anchor lives on page.tsx below.
        "components/ai-analyze-panel.tsx",
        "components/requirement-coverage-panel.tsx",
        "app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx",
        "components/submission-plan-reconciliation-panel.tsx",
        "components/submission-plan-truth-panel.tsx",
        "components/matching-selected-evidence-panel.tsx",
        "components/generation-action-panel.tsx",
        "components/authority-review-panel.tsx",
        "components/export-readiness-panel.tsx",
        "app/dashboard/tenders/[id]/page.tsx",
      ].map((file) => read(file)).join("\n");
      for (const id of targets) {
        const hasLiteralId = sources.includes(`id="${id}"`);
        const hasStableWorkflowStage = sources.includes(`workflow-stage-${id.at(-1)}`);
        const hasRenderedDefaultId = sources.includes(`sectionId = "${id}"`) && sources.includes("id={sectionId}");
        assert.ok(hasLiteralId || hasStableWorkflowStage || hasRenderedDefaultId, `Missing target #${id}`);
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
