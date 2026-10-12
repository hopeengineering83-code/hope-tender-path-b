import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const layout = readFileSync("app/dashboard/company/layout.tsx", "utf8");
const authority = readFileSync("components/company-profile-editor-authority.tsx", "utf8");
const subnav = readFileSync("components/company-subnav.tsx", "utf8");
const sectionSubnav = readFileSync("components/section-subnav.tsx", "utf8");
const inlineVault = readFileSync("app/dashboard/company/page.tsx", "utf8");
const labeledEditor = readFileSync("app/dashboard/company/profile/page.tsx", "utf8");

describe("single company profile editing authority", () => {
  it("retains the labeled editor as the only visible profile editing authority", () => {
    assert.match(layout, /CompanyProfileEditorAuthority/);
    assert.match(layout, /CompanySubnav/);
    assert.match(subnav, /href: "\/dashboard\/company\/profile"/);
    assert.match(subnav, /Labeled Profile Editor/);
    assert.match(authority, /One company profile editor/);
    assert.match(authority, /Open Company Profile Editor/);
    assert.match(authority, /href="\/dashboard\/company\/profile"/);
  });

  it("the company sub-nav is route-aware, not a hardcoded always-active tab", () => {
    // Confirmed real bug (screenshot evidence): the sub-nav previously
    // hardcoded "Labeled Profile Editor" with active styling regardless of
    // route, so it appeared active on /dashboard/company, /dashboard/company/
    // review-board, etc. — never just on its own route. It must now compute
    // active state from the real pathname, matching the primary sidebar's
    // own longest-match convention. CompanySubnav delegates this to the
    // shared SectionSubnav component (components/section-subnav.tsx), used
    // by every consolidated nav group so the active-state logic exists once.
    assert.match(subnav, /SectionSubnav/);
    assert.match(sectionSubnav, /usePathname\(\)/);
    assert.match(sectionSubnav, /isDashboardRouteWithin/);
    assert.doesNotMatch(subnav, /bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"/, "must not hardcode one tab as permanently active");
  });

  it("suppresses the legacy inline form without affecting other vault records", () => {
    assert.match(layout, /data-company-vault-content/);
    assert.match(layout, /\.space-y-6 > form\.max-w-3xl/);
    assert.match(layout, /display: none !important/);
    assert.match(inlineVault, /\{tab==="documents"/);
    assert.match(inlineVault, /\{tab==="experts"/);
    assert.match(inlineVault, /\{tab==="projects"/);
    assert.match(inlineVault, /\{tab==="compliance"/);
  });

  it("shows the authority notice only on the Knowledge Vault root", () => {
    assert.match(authority, /usePathname\(\)/);
    assert.match(authority, /pathname !== "\/dashboard\/company"/);
    assert.match(authority, /return null/);
  });

  it("preserves the labeled editor API save path and accessibility contracts", () => {
    assert.match(labeledEditor, /fetch\("\/api\/company"/);
    assert.match(labeledEditor, /method: "PUT"/);
    assert.match(labeledEditor, /<label htmlFor=\{id\}/);
    assert.match(labeledEditor, /role="alert" aria-live="assertive"/);
    assert.match(labeledEditor, /role="status" aria-live="polite"/);
    assert.match(labeledEditor, /Save labeled company profile/);
  });
});
