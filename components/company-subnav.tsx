"use client";

import { SectionSubnav, type SectionSubnavTab } from "./section-subnav";

// The full Company Vault family — consolidated here so the primary sidebar
// only needs one Company Vault destination. Automatic Verification is a source
// authority monitor, not a mandatory human approval queue.
const COMPANY_TABS_BASE: SectionSubnavTab[] = [
  { href: "/dashboard/company", label: "Knowledge Vault" },
  { href: "/dashboard/company/profile", label: "Labeled Profile Editor" },
  { href: "/dashboard/company/readiness", label: "Profile Readiness" },
  { href: "/dashboard/company/review", label: "Automatic Verification" },
  { href: "/dashboard/company/plan-b-import", label: "Legacy Data Import" },
  { href: "/dashboard/assets", label: "Brand Assets" },
  { href: "/dashboard/setup", label: "Setup Wizard" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function CompanySubnav({ setupComplete = false }: { setupComplete?: boolean }) {
  const tabs = setupComplete
    ? COMPANY_TABS_BASE.filter((tab) => tab.href !== "/dashboard/setup")
    : COMPANY_TABS_BASE;
  return <SectionSubnav tabs={tabs} label="Company workspace" />;
}
