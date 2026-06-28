import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenderReleaseSnapshot } from "@/lib/engine/release-snapshot";
import { reportError } from "@/lib/observability";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // TODO: Add auth session check
  const userId = "temp-user-id"; // Placeholder for actual session user

  try {
    const snapshot = await getTenderReleaseSnapshot(prisma, id, userId);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    void reportError(err, { tenderId: id, route: "release-snapshot" });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
