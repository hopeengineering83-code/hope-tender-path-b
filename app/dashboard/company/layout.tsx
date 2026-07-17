import type { ReactNode } from "react";
import Link from "next/link";
import { SecureUploadPolicyEnforcer } from "../../../components/secure-upload-policy-enforcer";

export default function CompanyVaultLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SecureUploadPolicyEnforcer />
      <nav aria-label="Company workspace" className="mb-5 flex min-w-0 flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <Link href="/dashboard/company" className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Knowledge Vault</Link>
        <Link href="/dashboard/company/profile" className="min-h-10 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">Labeled Profile Editor</Link>
        <Link href="/dashboard/company/review-board" className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Review Board</Link>
        <Link href="/dashboard/company/review" className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Diagnostics</Link>
      </nav>
      {children}
    </>
  );
}
