// Compliance-gap / final-export readiness parity.
//
// Bug found by owner-requested contradiction recheck: the final ZIP download
// route (app/api/tenders/[id]/download/route.ts) hard-blocks with a 409 on
// ANY unresolved CRITICAL compliance gap, but getFinalSubmissionReadiness()
// and getCanonicalTenderReadiness() — the resolvers that drive the "Ready
// for export" tile on the Bid Control panel, the Export Hub, and the
// Command Center's "Export gate is open" banner — never checked compliance
// gaps at all. A tender could show a green "Ready" badge and an enabled
// download link that then 409s when actually clicked.
//
// Fix: both resolvers now fetch unresolved CRITICAL complianceGaps and fold
// them into their readiness signal, so the badge and the real gate agree.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("final-submission-readiness.ts — unresolved CRITICAL compliance gaps block export readiness", () => {
  const src = read("lib/engine/final-submission-readiness.ts");

  it("fetches unresolved CRITICAL complianceGaps on the tender query", () => {
    assert.match(src, /complianceGaps:\s*\{\s*where:\s*\{\s*isResolved:\s*false,\s*severity:\s*"CRITICAL"\s*\}/);
  });

  it("pushes a CRITICAL_COMPLIANCE_GAPS tenderLevelBlocker when unresolved gaps exist", () => {
    assert.match(src, /if \(tender\.complianceGaps\.length > 0\)/);
    assert.match(src, /category:\s*"CRITICAL_COMPLIANCE_GAPS"/);
  });

  it("ok is computed from tenderLevelBlockers (which now includes the gap blocker)", () => {
    assert.match(src, /const ok = readiness\.ok && documentBlockers\.length === 0 && tenderLevelBlockers\.length === 0;/);
  });
});

describe("canonical-tender-readiness.ts — complianceGaps wired into computeTenderReadinessState + readyForFinalExport", () => {
  const src = read("lib/canonical-tender-readiness.ts");

  it("includes complianceGaps on the tender query", () => {
    assert.match(src, /complianceGaps:\s*\{\s*select:\s*\{\s*severity:\s*true,\s*isResolved:\s*true\s*\}\s*\}/);
  });

  it("passes complianceGaps into computeTenderReadinessState (previously defaulted to [] and never reflected real gaps)", () => {
    assert.match(src, /complianceGaps:\s*tender\.complianceGaps,\s*\n\s*\}\);/);
  });

  it("readyForFinalExport requires zero unresolved CRITICAL compliance gaps", () => {
    assert.match(src, /const unresolvedCriticalGaps = tender\.complianceGaps\.filter\(\(g\) => !g\.isResolved && g\.severity === "CRITICAL"\)\.length;/);
    assert.match(src, /readyForFinalExport:.*&&\s*unresolvedCriticalGaps === 0,/);
  });
});

// ─── DB-gated behavioral proof ──────────────────────────────────────────────
// Mirrors the seed pattern from tests/screenshot-export-gates-003-server.test.ts
// Gap 4 (user + tender, no company row required by these resolvers).

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("compliance-gap export parity — PostgreSQL behavioral", () => {
  it("getFinalSubmissionReadiness().ok is false when an unresolved CRITICAL compliance gap exists", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "compliance-gap-parity-test@example.test" },
        update: {},
        create: {
          email: "compliance-gap-parity-test@example.test",
          passwordHash: "$2a$10$placeholder",
          role: "ADMIN",
          name: "Compliance Gap Parity Test",
        },
      });
      const tender = await prisma.tender.create({
        data: { title: "Compliance Gap Parity Test Tender", userId: user.id },
      });
      await prisma.complianceGap.create({
        data: {
          tenderId: tender.id,
          title: "Missing mandatory insurance certificate",
          description: "Not found in any submitted document.",
          severity: "CRITICAL",
          isResolved: false,
        },
      });

      const { getFinalSubmissionReadiness } = await import("../lib/engine/final-submission-readiness");
      const readiness = await getFinalSubmissionReadiness(prisma, { tenderId: tender.id, userId: user.id });

      assert.ok(readiness, "readiness must return a result");
      assert.equal(readiness.ok, false, "tender with an unresolved CRITICAL compliance gap must NOT be export-ready");
      assert.ok(
        readiness.tenderLevelBlockers.some((b) => b.category === "CRITICAL_COMPLIANCE_GAPS"),
        "tenderLevelBlockers must include the CRITICAL_COMPLIANCE_GAPS blocker",
      );

      await prisma.complianceGap.deleteMany({ where: { tenderId: tender.id } });
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("getCanonicalTenderReadiness().readyForFinalExport is false when an unresolved CRITICAL compliance gap exists", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "canonical-gap-parity-test@example.test" },
        update: {},
        create: {
          email: "canonical-gap-parity-test@example.test",
          passwordHash: "$2a$10$placeholder",
          role: "ADMIN",
          name: "Canonical Gap Parity Test",
        },
      });
      await prisma.company.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, name: "Canonical Gap Parity Test Company" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Canonical Gap Parity Test Tender", userId: user.id },
      });
      await prisma.complianceGap.create({
        data: {
          tenderId: tender.id,
          title: "Missing mandatory insurance certificate",
          description: "Not found in any submitted document.",
          severity: "CRITICAL",
          isResolved: false,
        },
      });

      const { getCanonicalTenderReadiness } = await import("../lib/canonical-tender-readiness");
      const canonical = await getCanonicalTenderReadiness(prisma, user.id, tender.id);

      assert.ok(canonical, "canonical readiness must return a result");
      assert.equal(canonical.readyForFinalExport, false, "tender with an unresolved CRITICAL compliance gap must NOT be readyForFinalExport");

      await prisma.complianceGap.deleteMany({ where: { tenderId: tender.id } });
      await prisma.tender.delete({ where: { id: tender.id } });
      await prisma.company.delete({ where: { userId: user.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});

// ─── NO_BID status — another contradiction found in the same recheck pass ──
// The bid-decision route sets tender.status = "NO_BID" as a real reachable
// value, but neither TENDER_STATUSES/TENDER_STATUS_LABELS nor the
// StatusBadge color map had an entry for it, so it silently fell back to
// the same plain grey used for a brand-new DRAFT tender — on the dashboard
// and tenders-list pages a "decided not to bid" tender looked identical to
// one nobody has touched yet.

describe("NO_BID tender status — distinct label + color, not a silent DRAFT fallback", () => {
  it("TENDER_STATUSES includes NO_BID", () => {
    const src = read("lib/tender-workflow.ts");
    assert.match(src, /"NO_BID",\n\] as const;/);
  });

  it("TENDER_STATUS_LABELS has a NO_BID entry", () => {
    const src = read("lib/tender-workflow.ts");
    assert.match(src, /NO_BID:\s*"No Bid",/);
  });

  it("StatusBadge styles map has a NO_BID entry distinct from DRAFT's grey", () => {
    const src = read("components/status-badge.tsx");
    assert.match(src, /NO_BID:\s*"[^"]+"/);
    const draftStyle = /DRAFT:\s*"([^"]+)"/.exec(src)?.[1];
    const noBidStyle = /NO_BID:\s*"([^"]+)"/.exec(src)?.[1];
    assert.ok(draftStyle && noBidStyle && draftStyle !== noBidStyle, "NO_BID must not share DRAFT's style string");
  });
});

// ─── Real Playwright screenshot recheck findings ───────────────────────────
// Found by taking actual rendered screenshots against a real local
// production build + Postgres (owner-requested visual recheck), not just
// source inspection. Full behavioral coverage lives in the DB/E2E-gated
// tests below; these are fast source-inspection guards against regression.

describe("canonical-readiness-state.ts — CANONICAL_STATUS_CONFIG icons are rendered SVG, not raw Unicode", () => {
  const src = read("lib/engine/canonical-readiness-state.ts");

  it("no longer assigns raw Unicode glyphs to the icon field", () => {
    for (const glyph of ["✓", "⚠", "✗", "↻", "◑", "○"]) {
      assert.ok(!src.includes(`icon: "${glyph}"`), `icon field must not be the raw glyph ${glyph}`);
    }
  });

  it("uses createElement with real icon components instead", () => {
    assert.match(src, /icon: createElement\(CheckIcon\)/);
    assert.match(src, /icon: createElement\(WarningIcon\)/);
    assert.match(src, /icon: createElement\(CrossIcon\)/);
    assert.match(src, /icon: createElement\(RefreshIcon\)/);
    assert.match(src, /icon: createElement\(AlertCircleIcon\)/);
    assert.match(src, /icon: createElement\(CircleIcon\)/);
  });
});

describe("matching.ts — trust-level rationale text has no raw Unicode icon prefix", () => {
  const src = read("lib/engine/matching.ts");

  it("trustLevelLabel returns plain text, not a glyph-prefixed string", () => {
    assert.doesNotMatch(src, /return "✓ Reviewed"/);
    assert.doesNotMatch(src, /return "⚠ AI draft/);
    assert.doesNotMatch(src, /return "⚠ Regex draft/);
    assert.match(src, /return "Reviewed"/);
  });

  it("sort-priority detection matches the updated plain-text label", () => {
    assert.doesNotMatch(src, /rationale\.includes\("✓ Reviewed"\)/);
    assert.match(src, /rationale\.includes\("\[Reviewed\]"\)/);
  });
});

describe("ai-multi-perspective-matcher.ts — assessment rationale has no raw Unicode icon prefix", () => {
  const src = read("lib/engine/ai-multi-perspective-matcher.ts");

  it("strength/concern parts use plain-text labels, not glyph prefixes", () => {
    assert.doesNotMatch(src, /parts\.push\(`✓ /);
    assert.doesNotMatch(src, /parts\.push\(`⚠ /);
    assert.match(src, /parts\.push\(`Strength: /);
    assert.match(src, /parts\.push\(`Concern: /);
  });
});

describe("tender-intake-detail-panel.tsx — Detail value column has min-w-0 (mobile overflow fix)", () => {
  it("flex-1 value div has min-w-0 and break-words so long unbreakable values (e.g. submission emails) cannot push the page past the viewport", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.match(src, /className=\{`min-w-0 flex-1 break-words text-sm/);
  });
});

describe("tender report page — every table has an overflow-x-auto wrapper (mobile overflow fix)", () => {
  it("all 5 tables are wrapped so a wide table scrolls horizontally instead of pushing the whole page past the viewport", () => {
    const src = read("app/dashboard/tenders/[id]/report/page.tsx");
    const tableCount = (src.match(/<table className="w-full text-sm border-collapse">/g) ?? []).length;
    const wrapperCount = (src.match(/<div className="overflow-x-auto">/g) ?? []).length;
    assert.equal(tableCount, 5, "expected exactly 5 tables on the report page (regression guard if tables are added/removed)");
    assert.equal(wrapperCount, tableCount, "every table must have a matching overflow-x-auto wrapper");
  });
});

describe("empty-state.tsx — icon prop accepts a rendered element, not a raw emoji string", () => {
  it("icon prop is typed ReactNode and the JSDoc example no longer uses a raw emoji", () => {
    const src = read("components/empty-state.tsx");
    assert.match(src, /icon\?:\s*ReactNode/);
    assert.doesNotMatch(src, /icon="📋"/);
  });
});
