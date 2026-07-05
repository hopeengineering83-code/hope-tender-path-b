// GET /api/version
//
// Lightweight build/deployment info endpoint. No DB queries, no secrets.
// Used by the client build marker to detect stale browser cache and by
// manual QA to verify which commit is running in production.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 5;

export function GET() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "").slice(0, 8) || "dev";
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;

  return NextResponse.json({
    ok: true,
    appName: "Hope Tender",
    environment: env,
    gitCommitSha: sha,
    buildTime,
    featureFlags: {
      metadataOverride: true,
      collapsiblePanels: true,
      authorityReview: true,
      submissionPlanRepair: true,
    },
  });
}
