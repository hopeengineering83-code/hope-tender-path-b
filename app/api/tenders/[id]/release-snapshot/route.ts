import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/release-snapshot";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    await prismaReady;

    const { id } = await params;
    const snapshot = await getTenderReleaseSnapshot(prisma, id, userId);

    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
