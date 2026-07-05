import type { ReactNode } from "react";
import { SecureUploadPolicyEnforcer } from "../../../components/secure-upload-policy-enforcer";

export default function CompanyVaultLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SecureUploadPolicyEnforcer />
      {children}
    </>
  );
}
