import { NextResponse } from "next/server";

export function livenessResponse() {
  return NextResponse.json(
    {
      ok: true,
      status: "alive",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
