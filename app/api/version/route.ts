// GET /api/version
//
// Lightweight build/deployment info endpoint. No DB queries, no secrets.
// Used by the client build marker to detect stale browser cache and by
// manual QA to verify which commit and deployment context are running.

import { NextResponse } from "next/server";
import {
  resolveBuildSha,
  resolveDeploymentEnvironment,
} from "../../../lib/deployment-context.cjs";

export const dynamic = "force-dynamic";
export const maxDuration = 5;

export function GET() {
  const sha = resolveBuildSha(process.env);
  const environment = resolveDeploymentEnvironment(process.env);
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;

  return NextResponse.json({
    ok: true,
    appName: "Hope Tender",
    environment,
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
