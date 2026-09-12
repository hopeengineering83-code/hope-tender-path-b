import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const {
  resolveDeploymentEnvironment,
  resolveBuildSha,
  deploymentEnvironmentLabel,
} = require("../lib/deployment-context.cjs") as {
  resolveDeploymentEnvironment: (env: Record<string, string | undefined>) => string;
  resolveBuildSha: (env: Record<string, string | undefined>) => string;
  deploymentEnvironmentLabel: (environment: string) => string;
};

const badgeSource = readFileSync("components/build-version-badge.tsx", "utf8");
const systemSource = readFileSync("app/dashboard/system/page.tsx", "utf8");
const nextConfigSource = readFileSync("next.config.js", "utf8");
const versionRouteSource = readFileSync("app/api/version/route.ts", "utf8");

describe("deployment context truth", () => {
  it("treats VERCEL_ENV as the deployment authority", () => {
    assert.equal(resolveDeploymentEnvironment({ VERCEL_ENV: "production", NODE_ENV: "production", CI: "true" }), "production");
    assert.equal(resolveDeploymentEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" }), "preview");
  });

  it("does not call every NODE_ENV=production build a production deployment", () => {
    assert.equal(resolveDeploymentEnvironment({ CI: "true", NODE_ENV: "production" }), "ci");
    assert.equal(resolveDeploymentEnvironment({ NODE_ENV: "production" }), "local-build");
    assert.equal(deploymentEnvironmentLabel("ci"), "CI validation build");
    assert.equal(deploymentEnvironmentLabel("local-build"), "Local production-mode build");
  });

  it("reports missing commit identity explicitly", () => {
    assert.equal(resolveBuildSha({}), "unavailable");
    assert.equal(resolveBuildSha({ VERCEL_GIT_COMMIT_SHA: "1234567890abcdef" }), "12345678");
    assert.match(badgeSource, /commit unavailable/);
    assert.doesNotMatch(badgeSource, /build <code>\{CLIENT_SHA\}/);
  });

  it("uses the same resolver in build-time and runtime identity surfaces", () => {
    assert.match(nextConfigSource, /resolveDeploymentEnvironment\(process\.env\)/);
    assert.match(nextConfigSource, /resolveBuildSha\(process\.env\)/);
    assert.match(versionRouteSource, /resolveDeploymentEnvironment\(process\.env\)/);
    assert.match(versionRouteSource, /resolveBuildSha\(process\.env\)/);
  });

  it("separates deployment context from operational readiness", () => {
    assert.match(systemSource, /Deployment context/);
    assert.match(systemSource, /Operational readiness/);
    assert.match(systemSource, /Production prerequisites incomplete/);
    assert.doesNotMatch(systemSource, /Not production ready yet/);
  });
});
