import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { computeTenderLifecycle } from "../../../../../lib/engine/tender-lifecycle-orchestrator";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: tenderId } = await params;

    const result = await computeTenderLifecycle(prisma, tenderId);

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Tender not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[lifecycle]", error);
    const message = error instanceof Error ? error.message : "Failed to compute lifecycle";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
