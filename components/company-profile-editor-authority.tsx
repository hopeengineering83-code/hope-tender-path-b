"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The Knowledge Vault historically contained an unlabeled inline profile form
 * while `/dashboard/company/profile` exposed the accessible labeled editor.
 * Both wrote to the same API, so users could maintain two unsaved drafts and
 * could not tell which screen was authoritative.
 *
 * The large Knowledge Vault remains responsible for documents, experts,
 * projects, and compliance records. This guard removes its legacy profile form
 * from rendering and directs profile changes to the one labeled editor.
 */
export function CompanyProfileEditorAuthority() {
  const pathname = usePathname();
  if (pathname !== "/dashboard/company") return null;

  return (
    <section
      aria-labelledby="company-profile-authority-title"
      className="mb-5 flex min-w-0 flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h2 id="company-profile-authority-title" className="text-sm font-semibold text-blue-950">
          One company profile editor
        </h2>
        <p className="mt-1 text-sm leading-6 text-blue-800">
          Company identity, contact, proposal profile, and institutional facts are edited only in the labeled Company Profile Editor. Documents, experts, projects, and compliance records remain in this Knowledge Vault.
        </p>
      </div>
      <Link
        href="/dashboard/company/profile"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
      >
        Open Company Profile Editor
      </Link>
    </section>
  );
}
