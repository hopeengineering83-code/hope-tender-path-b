import type { ReactNode } from "react";
import { requireDashboardRole } from "../../../lib/dashboard-role-guard";
import { prisma, prismaReady } from "../../../lib/prisma";
import { SecureUploadPolicyEnforcer } from "../../../components/secure-upload-policy-enforcer";
import { CompanyProfileEditorAuthority } from "../../../components/company-profile-editor-authority";
import { CompanySubnav } from "../../../components/company-subnav";

export default async function CompanyVaultLayout({ children }: { children: ReactNode }) {
  const user = await requireDashboardRole("ADMIN", "PROPOSAL_MANAGER");
  await prismaReady;
  const company = await prisma.company.findUnique({ where: { userId: user.id }, select: { setupCompletedAt: true } });
  return (
    <>
      <SecureUploadPolicyEnforcer />
      <CompanySubnav setupComplete={Boolean(company?.setupCompletedAt)} />
      <CompanyProfileEditorAuthority />
      <style>{`
        [data-company-vault-content] > .space-y-6 > form.max-w-3xl {
          display: none !important;
        }
      `}</style>
      <div data-company-vault-content>{children}</div>
    </>
  );
}
