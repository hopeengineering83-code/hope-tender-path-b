import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getSystemReadiness } from "../../../../lib/system-readiness";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ readiness: getSystemReadiness() });
}
