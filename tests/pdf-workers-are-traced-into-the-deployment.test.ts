/**
 * The PDF workers must be PACKAGED, not merely installed.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real owner run on the exact-head Preview logged, on every surface that
 * reads a PDF — tender intake, Authority Review, export readiness and
 * AUTO_FINALIZE:
 *
 *   [extract-text] pdf-parse failed: Setting up fake worker failed:
 *   "Cannot find module '/var/task/node_modules/pdf-parse/dist/pdf-parse/
 *    cjs/pdf.worker.mjs'"
 *   [extract-text] pdfjs failed: … '/var/task/node_modules/pdfjs-dist/
 *    legacy/build/pdf.worker.mjs'
 *
 * Both libraries load their worker through a runtime dynamic import built
 * from a computed path. Next.js output tracing cannot follow that, so the
 * worker never entered the serverless bundle — while every local run passed,
 * because locally the file is simply there in node_modules.
 *
 * extractTextFromBuffer races three extractors and keeps the best result, so
 * nothing failed loudly: pdf2json survived alone and PDF text quietly
 * degraded to the weakest of the three on the only environment that matters.
 * A test that reads a PDF on localhost cannot see this at all — which is
 * exactly why it went unnoticed.
 *
 * So this test deliberately asserts the PACKAGING CONTRACT rather than
 * extraction behaviour: the files the deployment will look for must be named
 * in outputFileTracingIncludes AND must actually exist at those paths. A
 * dependency upgrade that relocates a worker breaks this test instead of
 * silently degrading production again.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** The worker paths the deployed runtime resolves, as seen in the logs above. */
const REQUIRED_WORKERS = [
  "node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
];

describe("PDF workers reach the deployment, not just the dev machine", () => {
  const config = readFileSync(path.join(ROOT, "next.config.js"), "utf8");

  for (const worker of REQUIRED_WORKERS) {
    it(`names ${path.basename(path.dirname(worker))}/${path.basename(worker)} in outputFileTracingIncludes`, () => {
      assert.ok(
        config.includes(`./${worker}`),
        `next.config.js must trace ./${worker} or the deployed runtime cannot load it`,
      );
    });

    it(`resolves ${worker.split("/")[1]}'s worker to a real file at that exact path`, () => {
      // Guards the upgrade case: if a future version moves or renames the
      // worker, the traced path silently stops matching anything and the
      // deployment regresses to the same fake-worker failure.
      const full = path.join(ROOT, worker);
      assert.ok(existsSync(full), `${worker} does not exist — the traced path is stale`);
      assert.ok(statSync(full).size > 10_000, `${worker} is implausibly small for a PDF worker bundle`);
    });
  }

  it("keeps the tracing list anchored to the config's own include block", () => {
    // Cheap structural check: the workers must sit inside
    // outputFileTracingIncludes, not merely appear somewhere in the file
    // (a comment mentioning the path would otherwise satisfy the test above).
    const start = config.indexOf("outputFileTracingIncludes");
    assert.ok(start > 0, "outputFileTracingIncludes must exist");
    const block = config.slice(start, start + 2500);
    for (const worker of REQUIRED_WORKERS) {
      assert.ok(block.includes(`"./${worker}"`), `./${worker} must be inside outputFileTracingIncludes`);
    }
  });

  it("still traces the runtime fonts that share this failure mode", () => {
    // The Ethiopic faces are read with a runtime readFileSync and were the
    // first casualty of this same tracing gap. Losing them again would break
    // non-Latin PDF output on the deployment only.
    const start = config.indexOf("outputFileTracingIncludes");
    const block = config.slice(start, start + 2500);
    assert.ok(block.includes("./assets/fonts/**"), "runtime font tracing must not be dropped");
  });
});
