// Compliance-gap / final-export readiness parity.
//
// Bug found by owner-requested contradiction recheck: the final ZIP download
// route hard-blocks unresolved CRITICAL compliance gaps, while the UI-facing
// readiness resolvers previously did not. Both authorities must agree.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("final-submission-readiness.ts — unresolved CRITICAL compliance gaps block export readiness", () => {
  const src = read("lib/engine/final-submission-readiness.ts");

  it("fetches unresolved CRITICAL complianceGaps on the tender query", () => {
    assert.match(src, /complianceGaps:\s*\{\s*where:\s*\{\s*isResolved:\s*false,\s*severity:\s*"CRITICAL"\s*\}/);
  });

  it("pushes a CRITICAL_COMPLIANCE_GAPS tenderLevelBlocker when unresolved gaps exist", () => {
    assert.match(src, /if \(tender\.complianceGaps\.length > 0\)/);
    assert.match(src, /category:\s*"CRITICAL_COMPLIANCE_GAPS"/);
  });

  it("ok is computed from tenderLevelBlockers", () => {
    assert.match(src, /const ok = readiness\.ok && documentBlockers\.length === 0 && tenderLevelBlockers\.length === 0;/);
  });
});

describe("canonical-tender-readiness.ts — complianceGaps wired into canonical export readiness", () => {
  const src = read("lib/canonical-tender-readiness.ts");

  it("includes complianceGaps on the tender query", () => {
    assert.match(src, /complianceGaps:\s*\{\s*select:\s*\{\s*severity:\s*true,\s*isResolved:\s*true\s*\}\s*\}/);
  });

  it("passes complianceGaps into computeTenderReadinessState", () => {
    assert.match(src, /complianceGaps:\s*tender\.complianceGaps,\s*\n\s*\}\);/);
  });

  it("readyForFinalExport requires zero unresolved CRITICAL compliance gaps", () => {
    assert.match(src, /const unresolvedCriticalGaps = tender\.complianceGaps\.filter\(\(g\) => !g\.isResolved && g\.severity === "CRITICAL"\)\.length;/);
    assert.match(src, /readyForFinalExport:.*&&\s*unresolvedCriticalGaps === 0,/);
  });
});

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

      assert.ok(readiness);
      assert.equal(readiness.ok, false);
      assert.ok(readiness.tenderLevelBlockers.some((blocker) => blocker.category === "CRITICAL_COMPLIANCE_GAPS"));

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

      assert.ok(canonical);
      assert.equal(canonical.readyForFinalExport, false);

      await prisma.complianceGap.deleteMany({ where: { tenderId: tender.id } });
      await prisma.tender.delete({ where: { id: tender.id } });
      await prisma.company.delete({ where: { userId: user.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});

describe("NO_BID tender status — distinct label and color", () => {
  it("TENDER_STATUSES includes NO_BID", () => {
    const src = read("lib/tender-workflow.ts");
    assert.match(src, /"NO_BID",\n\] as const;/);
  });

  it("TENDER_STATUS_LABELS has a NO_BID entry", () => {
    const src = read("lib/tender-workflow.ts");
    assert.match(src, /NO_BID:\s*"No Bid",/);
  });

  it("StatusBadge styles NO_BID differently from DRAFT", () => {
    const src = read("components/status-badge.tsx");
    const draftStyle = /DRAFT:\s*"([^"]+)"/.exec(src)?.[1];
    const noBidStyle = /NO_BID:\s*"([^"]+)"/.exec(src)?.[1];
    assert.ok(draftStyle && noBidStyle && draftStyle !== noBidStyle);
  });
});

describe("canonical-readiness-state.ts — status icons are SVG components", () => {
  const src = read("lib/engine/canonical-readiness-state.ts");

  it("does not assign raw Unicode glyphs to the icon field", () => {
    for (const glyph of ["✓", "⚠", "✗", "↻", "◑", "○"]) {
      assert.ok(!src.includes(`icon: "${glyph}"`));
    }
  });

  it("uses real icon components", () => {
    assert.match(src, /icon: createElement\(CheckIcon\)/);
    assert.match(src, /icon: createElement\(WarningIcon\)/);
    assert.match(src, /icon: createElement\(CrossIcon\)/);
    assert.match(src, /icon: createElement\(RefreshIcon\)/);
    assert.match(src, /icon: createElement\(AlertCircleIcon\)/);
    assert.match(src, /icon: createElement\(CircleIcon\)/);
  });
});

describe("matching presentation removes legacy raw Unicode prefixes", () => {
  const page = read("app/dashboard/matching/page.tsx");
  const dashboard = read("app/dashboard/matching/matching-dashboard.tsx");
  // presentMatchRationale lives in its own module, not exported from page.tsx —
  // Next.js App Router page.tsx files may only export `default` and a small
  // reserved set (generateMetadata, dynamic, ...); an arbitrary named function
  // export fails the build ("is not a valid Page export field").
  const rationaleHelper = read("app/dashboard/matching/present-match-rationale.ts");

  it("sanitizes legacy stored rationales before rendering", () => {
    assert.match(page, /import \{ presentMatchRationale \} from "\.\/present-match-rationale"/);
    assert.match(rationaleHelper, /export function presentMatchRationale/);
    assert.match(rationaleHelper, /replace\(\/\[✓✔☑⚠⚠️▲▼←→\]\/gu, ""\)/);
    assert.match(page, /rationale: presentMatchRationale\(match\.rationale\)/);
  });

  it("page.tsx does not export presentMatchRationale itself (Next.js Page contract)", () => {
    assert.ok(
      !/^export function presentMatchRationale/m.test(page),
      "page.tsx must not export arbitrary named functions — Next.js App Router rejects the build otherwise",
    );
  });

  it("renders trust and selection states with icon components", () => {
    assert.match(dashboard, /CheckIcon/);
    assert.match(dashboard, /WarningIcon/);
    assert.match(dashboard, /ChevronDownIcon/);
    assert.doesNotMatch(dashboard, /[✓⚠▲▼←→]/u);
  });
});

describe("ai-multi-perspective-matcher rationale uses plain-text labels", () => {
  const src = read("lib/engine/ai-multi-perspective-matcher.ts");
  assert.doesNotMatch(src, /parts\.push\(`✓ /);
  assert.doesNotMatch(src, /parts\.push\(`⚠ /);
  assert.match(src, /parts\.push\(`Strength: /);
  assert.match(src, /parts\.push\(`Concern: /);
});

describe("mobile source-inspection guards", () => {
  it("tender intake detail values cannot push past the viewport", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.match(src, /className=\{`min-w-0 flex-1 break-words text-sm/);
  });

  it("every report table has an overflow-x-auto wrapper", () => {
    const src = read("app/dashboard/tenders/[id]/report/page.tsx");
    const tableCount = (src.match(/<table className="w-full text-sm border-collapse">/g) ?? []).length;
    const wrapperCount = (src.match(/<div className="overflow-x-auto">/g) ?? []).length;
    assert.equal(tableCount, 5);
    assert.equal(wrapperCount, tableCount);
  });
});
