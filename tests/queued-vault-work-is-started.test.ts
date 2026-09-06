// Queuing durable work and running it are two different things.
//
// Uploading a Company Vault document enqueues a VAULT_INGEST job
// (lib/secure-upload-handler.ts) and the Company page reports:
//
//   "Document stored. Extraction and source-verification queued —
//    this completes automatically, no action needed."
//
// Nothing in that path claimed the job. The two manual repair controls
// (reimportAll, reprocess) each woke the worker inline, but the upload path —
// the only one on the owner's normal route, and the one whose whole promise is
// that no action is needed — did not. The other claimant,
// .github/workflows/drain-ai-job-queue.yml, posts to the PRODUCTION host, so a
// preview deployment had no runner for the queue at all.
//
// The job therefore sat QUEUED forever. Downstream that reads as:
//   - CompanyDocument.extractedText stays null           -> "0 extracted"
//   - integrityStatus stays at its "UNKNOWN" default     -> sourceByteIntegrityIsVerified() false
//   - so no Expert or Project record can cite a source   -> 0 verified of 28 experts / 114 projects
//   - so evidence cannot be matched                      -> the final ZIP is blocked
//
// The owner saw the end of that chain (an Evidence gaps panel full of
// CRITICALs) and reasonably concluded extraction was broken. Extraction was
// fine. It had simply never been asked to run.
//
// The rule below is deliberately about the WHOLE client surface rather than
// the one function that was broken: any future code that tells the user vault
// work is queued and automatic must also start it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app/dashboard"];

/** Strip comments so prose describing the defect is never itself a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Split a module into top-level-ish function bodies by brace depth, so a
 * "queues but never starts" function cannot be excused by a sibling function
 * elsewhere in the same file that happens to start the worker.
 */
export function functionBodies(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const header = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:useCallback\()?\s*(?:async\s*)?\(/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(src)) !== null) {
    const name = match[1] ?? match[2] ?? "(anonymous)";
    const open = src.indexOf("{", match.index + match[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    out.push({ name, body: src.slice(open, end + 1) });
  }
  return out;
}

/** Does this function body put durable Company Vault work on the queue? */
export function queuesVaultWork(body: string): boolean {
  return /companyImport/.test(body) || /["'`]\/api\/company\/reimport["'`]/.test(body);
}

/** Does it then start that work? */
export function startsVaultWork(body: string): boolean {
  return /startQueuedVaultIngestion\s*\(/.test(body);
}

function uiFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) out.push(full);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

describe("client code that queues Company Vault work also starts it", () => {
  it("holds across every dashboard component and page", () => {
    const offenders: string[] = [];
    for (const file of uiFiles()) {
      const src = code(readFileSync(file, "utf8"));
      for (const fn of functionBodies(src)) {
        if (queuesVaultWork(fn.body) && !startsVaultWork(fn.body)) {
          offenders.push(`${file} :: ${fn.name}()`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these queue VAULT_INGEST but never claim it. The scheduled drain targets the " +
        "production host only, so on a preview deployment the job has no runner and the " +
        "vault stays unextracted — which blocks every downstream evidence gate.",
    );
  });

  it("the upload path specifically is covered", () => {
    // The general sweep above would still pass if the upload handler stopped
    // reading companyImport altogether, so pin the actual call site.
    //
    // INNERMOST, not first: the upload handler is nested inside the page
    // component, whose body also contains reimportAll — which does start the
    // worker. Taking the first match therefore graded the upload path on its
    // sibling's behaviour and passed with the fix reverted. The smallest
    // enclosing function is the one that has to be right.
    const page = code(readFileSync("app/dashboard/company/page.tsx", "utf8"));
    const uploadBody = functionBodies(page)
      .filter((fn) => /companyImport/.test(fn.body))
      .sort((a, b) => a.body.length - b.body.length)[0];
    assert.ok(uploadBody, "the Company page must still handle the upload response's companyImport");
    assert.ok(
      startsVaultWork(uploadBody.body),
      "uploading a vault document must start the VAULT_INGEST job it queues — this is the " +
        "defect the owner hit: 6 documents, 0 extracted, integrity unverified, ZIP blocked",
    );
  });

  it("nobody hand-rolls the worker call for this job type", () => {
    // Three copies of the same literal is how one of them drifted out of sync.
    const offenders: string[] = [];
    for (const file of uiFiles()) {
      const src = code(readFileSync(file, "utf8"));
      if (/run-next\?jobType=VAULT_INGEST/.test(src)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "use startQueuedVaultIngestion() from lib/ui/auto-pipeline");
  });
});

describe("the detector is not vacuous", () => {
  it("flags a body that queues without starting", () => {
    const broken = `{
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.companyImport && data.companyImport.status === "QUEUED") {
        setVaultPipeline({ phase: "queued", message: "completes automatically" });
      }
    }`;
    assert.equal(queuesVaultWork(broken), true);
    assert.equal(startsVaultWork(broken), false);
  });

  it("accepts a body that starts what it queued", () => {
    const fixed = `{
      const res = await fetch("/api/company/reimport", { method: "POST" });
      if (res.ok) void startQueuedVaultIngestion();
    }`;
    assert.equal(queuesVaultWork(fixed), true);
    assert.equal(startsVaultWork(fixed), true);
  });

  it("ignores functions that do no vault queuing", () => {
    const unrelated = `{ setExpertForm({ fullName: "" }); return null; }`;
    assert.equal(queuesVaultWork(unrelated), false);
  });

  it("splits functions rather than reading a whole file at once", () => {
    // Without real splitting, a file containing ANY call to the starter would
    // excuse every broken function in it — which is exactly the state the
    // Company page was in: two functions started the worker, the upload path
    // did not, and a file-level check would have called that clean.
    const twoFunctions = `
      async function queuesButDoesNotStart() {
        const data = await res.json();
        if (data.companyImport) setVaultPipeline({ phase: "queued" });
      }
      async function elsewhereInTheSameFile() {
        void startQueuedVaultIngestion();
      }
    `;
    const bodies = functionBodies(twoFunctions);
    assert.equal(bodies.length, 2);
    const broken = bodies.find((fn) => fn.name === "queuesButDoesNotStart")!;
    assert.equal(queuesVaultWork(broken.body), true);
    assert.equal(startsVaultWork(broken.body), false);
  });
});

describe("the premise still holds", () => {
  it("the upload handler really does enqueue VAULT_INGEST without running it", () => {
    // If the server ever starts claiming the job itself, the client nudge
    // becomes belt-and-braces rather than the only runner, and this whole
    // rule deserves revisiting instead of quietly passing.
    const handler = readFileSync("lib/secure-upload-handler.ts", "utf8");
    assert.match(handler, /jobType:\s*"VAULT_INGEST"/);
    assert.match(handler, /companyImport = \{ status: "QUEUED"/);
  });

  it("the scheduled drain targets production, not the preview the owner uses", () => {
    // This is why the client nudge is load-bearing rather than an optimisation.
    const workflow = readFileSync(".github/workflows/drain-ai-job-queue.yml", "utf8");
    assert.match(workflow, /WORKER_URL:\s*https:\/\/hope-tender-path-b\.vercel\.app/);
  });
});
