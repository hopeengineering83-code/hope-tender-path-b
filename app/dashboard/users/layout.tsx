import type { ReactNode } from "react";
import { requireDashboardRole } from "../../../lib/dashboard-role-guard";

export default async function UsersLayout({ children }: { children: ReactNode }) {
  await requireDashboardRole("ADMIN");
  return children;
}
