// GET /api/admin/db-recovery
//
// ADMIN-only, READ-ONLY database recovery status for a restored (e.g. Neon
// point-in-time) database. Returns only a sanitized snapshot — booleans,
// counts, and field-name-level compatibility flags. It NEVER exposes
// DATABASE_URL, host, database name, credentials, user records, file bytes, or
// document content. It performs no writes and no migrations; any repair is a
// dry-run preview the operator must act on explicitly.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getDbRecoveryStatus, buildRepairPreview } from "../../../../lib/db-recovery/status";

export const dynamic = "force-dynamic";

export async function GET() {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;

  try {
    const status = await getDbRecoveryStatus(prisma, actor.id);
    const repairPreview = buildRepairPreview(status);
    return NextResponse.json({ status, repairPreview });
  } catch {
    // Even the error path must not leak connection details.
    return NextResponse.json(
      { status: { reachable: false, schemaCompatibility: "UNKNOWN" }, error: "Database recovery status is temporarily unavailable." },
      { status: 503 },
    );
  }
}
