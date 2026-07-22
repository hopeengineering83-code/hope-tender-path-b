import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DASHBOARD_NAV_GROUPS,
  flattenDashboardLinks,
  getActiveDashboardHref,
} from "../lib/dashboard-navigation";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("canonical navigation and command-center interlinking", () => {
  it("keeps exactly five primary destinations and maps Overview to Tenders", () => {
    const links = flattenDashboardLinks(DASHBOARD_NAV_GROUPS);
    assert.equal(links.length, 5);
    assert.equal(getActiveDashboardHref("/dashboard", DASHBOARD_NAV_GROUPS), "/dashboard/tenders");
    const tenders = links.find((link) => link.href === "/dashboard/tenders");
    assert.ok(tenders?.memberHrefs?.includes("/dashboard"));
  });

  it("uses disclosure-aware links for command-center hash targets", () => {
    const page = read("app/dashboard/tenders/[id]/command-center/page.tsx");
    assert.ok(page.includes('import { DisclosureAwareLink }'));
    assert.ok(page.includes("<DisclosureAwareLink"));
    assert.ok(!page.includes('<Link href={href}'));
  });

  it("waits for the destination and reveals hidden workflow targets", () => {
    const link = read("app/dashboard/tenders/[id]/command-center/disclosure-aware-link.tsx");
    assert.ok(link.includes("window.location.pathname !== url.pathname"));
    assert.ok(link.includes("document.querySelector(hash)"));
    assert.ok(link.includes("openParentDetailsAndScroll(element)"));
    assert.ok(link.includes("window.setInterval"));
    assert.ok(link.includes("attempts >= 50"));
  });

  it("removes the dead tender breadcrumb component", () => {
    assert.equal(existsSync(join(process.cwd(), "components/tender-breadcrumb.tsx")), false);
  });
});
