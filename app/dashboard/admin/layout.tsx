import type { ReactNode } from "react";
import { requireDashboardRole } from "../../../lib/dashboard-role-guard";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireDashboardRole("ADMIN");
  return children;
}
