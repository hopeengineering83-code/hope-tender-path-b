import { NextResponse } from "next/server";
import {
  authenticateServiceRequest,
  readTenderStatus,
  SERVICE_SCOPE_TENDER_STATUS,
} from "../../../../../lib/service-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/service/v1/tender-status
 *
 * Read-only status of ONE tenant's tenders for a service client holding a ServiceAccessGrant
 * (Authorization: Bearer hsa_…). The grant decides the tenant: there is no user or tender id in
 * the request, so a grant can never be pointed at someone else's data. Only the minimal fields
 * in lib/service-access.ts TENDER_STATUS_SELECT are returned — never client details, pricing,
 * notes, files, documents or job contents. Nothing is written except the grant's last-use time.
 */
export async function GET(req: Request) {
  const auth = await authenticateServiceRequest(req, SERVICE_SCOPE_TENDER_STATUS);
  if (!auth.ok) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (auth.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="hope-tender-service"';
    if (auth.retryAfter) headers["Retry-After"] = String(Math.max(1, auth.retryAfter));
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  }
  const status = await readTenderStatus(auth.userId);
  return NextResponse.json(
    { ...status, grant: { id: auth.grantId, expiresAt: auth.expiresAt.toISOString() } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
