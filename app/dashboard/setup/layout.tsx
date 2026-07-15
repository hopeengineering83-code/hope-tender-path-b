import type { ReactNode } from "react";
import { requireDashboardRole } from "../../../lib/dashboard-role-guard";

export default async function SetupLayout({ children }: { children: ReactNode }) {
  await requireDashboardRole("ADMIN", "PROPOSAL_MANAGER");
  return children;
}
