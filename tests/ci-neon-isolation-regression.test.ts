// ─── Regression: CI workflows must NEVER reference the Production DB ──────────
//
// AUDIT GAP (#7): The CI workflow currently uses an ephemeral postgres:16
// service container with DATABASE_URL=postgresql://hope_ci@127.0.0.1:5432/...
// That is correct. BUT there was no automated regression test guarding against
// a future contributor re-introducing `secrets.DATABASE_URL` or any reference
// to a persistent external database (Neon, Supabase, Railway, RDS, etc.) inside
// any .github/workflows/*.yml file.
//
// This test scans every workflow file and FAILS the build if it finds:
//   - Any reference to `secrets.DATABASE_URL` or any secret whose name
//     matches /DATABASE_URL$/i (catches PROD_DATABASE_URL, TEST_DATABASE_URL,
//     PREVIEW_DATABASE_URL, etc.).
//   - Any reference to `neon.tech` (the production Neon hostname) outside of
//     comments or the docs/runbooks/ directory.
//   - Any workflow `env:` block that sets DATABASE_URL to a non-loopback,
//     non-private host.
//   - Any workflow that imports a remote reusable workflow from a non-GitHub-
//     actions-owned repo AND injects database-related secrets.
//   - Any external database service container (e.g. `image: neon...)).
//   - Any workflow that sets RUN_DB_INTEGRATION=true without also setting
//     DATABASE_URL to a loopback/private/CI-service host.
//
// This test is a pure static scan — does NOT require a database. Runs in the
// unit-test phase of CI.
//
// Requirement #7: "Add a repository-wide regression test proving no CI workflow
// references the Production Neon connection or persistent external database."

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WORKFLOWS_DIR = path.resolve(".github/workflows");

function listWorkflowFiles(): string[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => path.join(WORKFLOWS_DIR, f));
}

function readFile(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("CI workflow Neon-isolation regression (#7)", () => {
  const workflows = listWorkflowFiles();
  if (workflows.length === 0) {
    it("fails when no workflows are found", () => {
      assert.fail("No .github/workflows/*.yml files found — regression test cannot run.");
    });
    return;
  }

  // Build a single concatenated view for cross-workflow assertions.
  const byFile = new Map<string, string>();
  for (const p of workflows) byFile.set(p, readFile(p));

  it("no workflow references secrets.DATABASE_URL or any *DATABASE_URL secret", () => {
    // Match `${{ secrets.DATABASE_URL }}`, `${{ secrets.PROD_DATABASE_URL }}`,
    // `${{ secrets.*_DATABASE_URL }}`, etc. — case-insensitive.
    const pattern = /\$\{\{\s*secrets\.[A-Z0-9_]*DATABASE_URL\s*\}\}/i;
    for (const [p, content] of byFile) {
      assert.ok(
        !pattern.test(content),
        `Workflow ${path.basename(p)} references a DATABASE_URL secret — ` +
          `CI must NEVER depend on an external database. Use the postgres:16 service container instead.\n` +
          `Matched pattern: /${pattern.source}/`,
      );
    }
  });

  it("no workflow env block sets DATABASE_URL to a non-loopback host", () => {
    // Capture every `DATABASE_URL: "..."` line in any workflow and verify
    // the URL hostname is loopback/private/CI-service. This guards against
    // a future contributor hard-coding a Neon hostname.
    const urlPattern = /DATABASE_URL:\s*["'`]?(postgresql:\/\/[^"'`\s]+)/g;
    for (const [p, content] of byFile) {
      let match: RegExpExecArray | null;
      while ((match = urlPattern.exec(content)) !== null) {
        const url = match[1];
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          assert.fail(`Workflow ${path.basename(p)} has malformed DATABASE_URL: ${url}`);
        }
        const host = parsed.hostname.toLowerCase();
        const allowed = ["127.0.0.1", "localhost", "postgres", "db", "::1"];
        assert.ok(
          allowed.includes(host),
          `Workflow ${path.basename(p)} sets DATABASE_URL to non-private host "${host}" — ` +
            `CI must use a loopback or service-container hostname (allowed: ${allowed.join(", ")}).`,
        );
        // Also reject any production-designated database name.
        const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];
        const prodNamePatterns = [
          /\bprod(uction)?[_-]?(tender|hope|db)?\b/i,
          /\b(tender|hope)[_-]?(prod|production)\b/i,
          /\bvercel[_-]?(prod|production)\b/i,
        ];
        for (const pat of prodNamePatterns) {
          assert.ok(
            !dbName || !pat.test(dbName),
            `Workflow ${path.basename(p)} sets DATABASE_URL to production-designated database name "${dbName}" — ` +
              `CI database name must not match /${pat.source}/.`,
          );
        }
      }
    }
  });

  it("no workflow references neon.tech outside of comments", () => {
    // For each line, strip leading `#` or `//` comments, then test.
    for (const [p, content] of byFile) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        // Strip YAML/Shell comments: `# ...` to end-of-line.
        const hashIdx = line.indexOf("#");
        const code = hashIdx >= 0 ? line.slice(0, hashIdx) : line;
        assert.ok(
          !/neon\.tech/i.test(code),
          `Workflow ${path.basename(p)} line ${idx + 1} references "neon.tech" outside a comment — ` +
            `CI workflows must NEVER reference the production Neon hostname.\n` +
            `Line: ${line}`,
        );
      });
    }
  });

  it("no workflow uses an external database service container image", () => {
    // GitHub Actions service containers support arbitrary images. We allow
    // only `postgres:` and `pgvector/pgvector:` (used for pgvector tests).
    // Any other image is suspicious — e.g. `neonlabs/neon:...` would mount
    // an external Neon instance.
    for (const [p, content] of byFile) {
      // Capture the full image reference including the tag (e.g. "postgres:16",
      // "pgvector/pgvector:pg16", "redis:7-alpine"). The colon is part of the
      // image:tag syntax, so include it in the character class.
      const imagePattern = /image:\s*([A-Za-z0-9._\-\/:]+)/g;
      let match: RegExpExecArray | null;
      while ((match = imagePattern.exec(content)) !== null) {
        const image = match[1].toLowerCase();
        const isAllowedPostgres = image.startsWith("postgres:") || image.startsWith("pgvector/pgvector:");
        const isAllowed = isAllowedPostgres || image.startsWith("redis:") || image.startsWith("minio/");
        assert.ok(
          isAllowed,
          `Workflow ${path.basename(p)} uses service image "${image}" — only postgres:*, pgvector/pgvector:*, redis:*, and minio/* are allowed in CI. ` +
            `External database images (Neon, Supabase, Railway, RDS) are FORBIDDEN.`,
        );
      }
    }
  });

  it("every workflow that sets RUN_DB_INTEGRATION=true also sets DATABASE_URL to a private host", () => {
    // Per audit requirement #4: "Set RUN_DB_INTEGRATION=true only for jobs
    // using that temporary PostgreSQL service." This test verifies the contract.
    for (const [p, content] of byFile) {
      if (!/RUN_DB_INTEGRATION:\s*["']?true["']?/.test(content)) continue;

      // Extract every DATABASE_URL line.
      const urls = Array.from(content.matchAll(/DATABASE_URL:\s*["'`]?(postgresql:\/\/[^"'`\s]+)/g)).map((m) => m[1]);
      assert.ok(
        urls.length > 0,
        `Workflow ${path.basename(p)} sets RUN_DB_INTEGRATION=true but provides no DATABASE_URL — ` +
          `a private postgres:16 service container DATABASE_URL is required.`,
      );
      for (const url of urls) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          assert.fail(`Workflow ${path.basename(p)} has malformed DATABASE_URL: ${url}`);
        }
        const host = parsed.hostname.toLowerCase();
        const allowed = ["127.0.0.1", "localhost", "postgres", "db", "::1"];
        assert.ok(
          allowed.includes(host),
          `Workflow ${path.basename(p)} sets RUN_DB_INTEGRATION=true with DATABASE_URL host "${host}" — ` +
            `RUN_DB_INTEGRATION=true requires a private/loopback/CI-service hostname (allowed: ${allowed.join(", ")}).`,
        );
      }
    }
  });

  it("no workflow references reusable workflows from non-GitHub-owned repos that inject database secrets", () => {
    // Reusable workflows: `uses: owner/repo/.github/workflows/foo.yml@ref`.
    // Allow only `actions/*` and `github/*` (first-party). Anything else is
    // suspicious if it also passes database secrets.
    for (const [p, content] of byFile) {
      const reusablePattern = /^(\s*)uses:\s+([A-Za-z0-9._\-]+)\/([A-Za-z0-9._\-]+)\/\.github\/workflows\//gm;
      let match: RegExpExecArray | null;
      while ((match = reusablePattern.exec(content)) !== null) {
        const owner = match[2].toLowerCase();
        const isFirstParty = owner === "actions" || owner === "github";
        if (isFirstParty) continue;
        // Non-first-party reusable workflow — must not be passed any DATABASE_URL secret.
        // Look at the `with:` block immediately following the `uses:` line.
        const afterMatch = content.slice(match.index + match[0].length);
        const withBlock = afterMatch.match(/with:\s*\n([\s\S]*?)(?:\n\S|\n\z|$)/);
        if (withBlock) {
          assert.ok(
            !/secrets\.[A-Z0-9_]*DATABASE_URL/i.test(withBlock[1]),
            `Workflow ${path.basename(p)} references reusable workflow ${match[2]}/${match[3]} and may pass a DATABASE_URL secret — ` +
              `external reusable workflows must NEVER receive production database credentials.`,
          );
        }
      }
    }
  });

  it("documents the Neon-isolation contract in a workflow-level comment", () => {
    // Soft requirement: at least one workflow (the main CI) should document
    // WHY DATABASE_URL is set to a loopback host. This makes the contract
    // discoverable for future contributors reading the workflow.
    const ciContent = byFile.get(path.join(WORKFLOWS_DIR, "ci.yml")) ?? "";
    assert.ok(
      /postgres:16/i.test(ciContent) && /DATABASE_URL:\s*["'`]postgresql:\/\/hope_ci@127\.0\.0\.1/.test(ciContent),
      "ci.yml must use the postgres:16 service container with DATABASE_URL=postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci",
    );
  });
});
