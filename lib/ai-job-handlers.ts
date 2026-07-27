// Canonical AI job-handler registry.
//
// The historical handler set remains in ai-job-handlers-legacy.ts for the
// non-extraction workflows. EXTRACT_TEXT is deliberately owned by the
// revision-bound background extraction service so upload requests never run
// extraction/OCR and a stale or cross-tenant source cannot be processed.

export * from "./ai-job-handlers-legacy";

import type { JobType } from "./ai-jobs";
import {
  getHandler as getLegacyHandler,
  type JobHandler,
} from "./ai-job-handlers-legacy";
import { runTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";

export function getHandler(jobType: JobType): JobHandler | undefined {
  if (jobType === "EXTRACT_TEXT") {
    return runTenderFileExtractionJob as JobHandler;
  }
  return getLegacyHandler(jobType);
}
