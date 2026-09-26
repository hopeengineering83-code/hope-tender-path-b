/**
 * Safe API Error Helper
 *
 * Shared error response builder for all readiness/state/export routes.
 * Never exposes raw Prisma errors, SQL, user IDs, tender IDs, stack
 * traces, or internal exception text to the API consumer.
 *
 * Server logs may contain technical details (keyed by diagnosticId).
 * API payloads contain only a safe user message + diagnosticId.
 */

import { NextResponse } from "next/server";
import { childLogger } from "../observability";

/**
 * Generate a short diagnostic ID for log correlation.
 */
export function newDiagnosticId(prefix = "api"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a safe error response for API routes.
 *
 * @param routeName — the route identifier (e.g. "export-readiness")
 * @param error — the caught error (logged server-side, never exposed)
 * @param opts — optional status code and user-facing message
 * @returns NextResponse with sanitized error payload
 */
export function safeApiError(
  routeName: string,
  error: unknown,
  opts: { status?: number; message?: string } = {},
): NextResponse {
  const diagnosticId = newDiagnosticId(routeName);
  const status = opts.status ?? 500;
  const message = opts.message ?? `${routeName.replace(/-/g, " ")} check failed. Diagnostic ID: ${diagnosticId}`;

  // Log the raw error server-side only — never in the response body.
  const rawDetail = error instanceof Error ? error.constructor.name : typeof error;
  childLogger({ route: `[${routeName}]` }).error(
    `${routeName} route failed (diagnosticId=${diagnosticId}): ${rawDetail}`,
  );

  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: message,
      code: `${routeName.toUpperCase().replace(/-/g, "_")}_RUNTIME_ERROR`,
      diagnosticId,
      blockers: [],
      warnings: [],
    },
    { status },
  );
}
