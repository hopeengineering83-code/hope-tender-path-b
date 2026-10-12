import type { APIRequestContext } from "@playwright/test";

export type ExtractedTenderSource = {
  fileId: string;
  fileName?: string;
  extractedTextLength: number;
};

type SourceFilesResponse = {
  ok?: boolean;
  files?: ExtractedTenderSource[];
};

type WorkerResponse = {
  jobId?: string | null;
  terminalStatus?: string | null;
  resultCode?: string | null;
};

export async function waitForDurableTenderExtraction(input: {
  request: APIRequestContext;
  tenderId: string;
  expectedFileCount: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  files: ExtractedTenderSource[];
  workerJobIds: string[];
}> {
  const timeoutMs = input.timeoutMs ?? 45_000;
  const pollIntervalMs = input.pollIntervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  const workerJobIds: string[] = [];
  let lastFiles: ExtractedTenderSource[] = [];
  let lastWorkerStatus = "not run";

  while (Date.now() < deadline) {
    const sourceResponse = await input.request.get(
      `/api/tenders/${input.tenderId}/source-files`,
    );
    if (sourceResponse.status() !== 200) {
      throw new Error(
        `Source-file status failed with HTTP ${sourceResponse.status()} while waiting for durable extraction.`,
      );
    }
    const sourceBody = await sourceResponse.json() as SourceFilesResponse;
    lastFiles = Array.isArray(sourceBody.files) ? sourceBody.files : [];
    if (
      sourceBody.ok !== false
      && lastFiles.length >= input.expectedFileCount
      && lastFiles.every((file) => Boolean(file.fileId) && file.extractedTextLength > 0)
    ) {
      return { files: lastFiles, workerJobIds };
    }

    const workerResponse = await input.request.post(
      "/api/ai-jobs/run-next?jobType=EXTRACT_TEXT",
    );
    if (workerResponse.status() >= 500) {
      throw new Error(
        `Extraction worker failed with HTTP ${workerResponse.status()} while processing the durable queue.`,
      );
    }
    const workerBody = await workerResponse.json().catch(() => ({})) as WorkerResponse;
    if (workerBody.jobId) workerJobIds.push(workerBody.jobId);
    lastWorkerStatus = `${workerResponse.status()}:${workerBody.terminalStatus ?? workerBody.resultCode ?? "UNKNOWN"}`;

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Durable extraction timed out: ${lastFiles.filter((file) => file.extractedTextLength > 0).length}/${input.expectedFileCount} file(s) extracted; last worker status ${lastWorkerStatus}.`,
  );
}
