import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { destroySession } from "../../../../lib/auth";

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Logout error:", { detail: error });
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
