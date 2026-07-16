import type { ReactNode } from "react";
import { requireDashboardRole } from "../../../lib/dashboard-role-guard";

export default async function AssetsLayout({ children }: { children: ReactNode }) {
  await requireDashboardRole("ADMIN", "PROPOSAL_MANAGER");
  return children;
}
