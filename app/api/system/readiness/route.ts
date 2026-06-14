import { NextResponse } from "next/server";
import { requireRole } from "../../../../lib/auth";
import { getSystemReadiness } from "../../../../lib/system-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const readiness = await getSystemReadiness();
  return NextResponse.json(
    { readiness },
    { status: readiness.productionReady ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
