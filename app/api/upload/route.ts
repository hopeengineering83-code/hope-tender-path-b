import { handleSecureUpload } from "../../../lib/secure-upload-handler";

// Restored /api/upload route.
//
// This route was deleted in commit f75b7f24 (2026-07-05) but is still called
// from the dashboard upload UI (`components/tender-source-files-panel.tsx:92`,
// `app/dashboard/company/page.tsx:300`, `app/dashboard/setup/page.tsx:76`)
// and is referenced by `docs/route-authorization-matrix.md`. Without it, every
// "Add files to existing tender" or "Upload company document" action from the
// dashboard returns 404 — the entire Company Vault intake flow is broken.
//
// The handler in `lib/secure-upload-handler.ts` is already complete: it
// validates files, verifies byte integrity, extracts text via the same
// pipeline used for tender uploads, persists CompanyDocument or TenderFile
// rows (with `pageStatusJson` for honest extraction diagnostics), and runs
// company-knowledge import for company documents.
//
// Both `tenderId` (add files to existing tender) and `companyDoc=true`
// (upload to Company Vault) modes are supported via the same handler.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleSecureUpload(req);
}
