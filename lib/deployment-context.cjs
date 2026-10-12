"use strict";

/**
 * Resolve the deployment context without confusing NODE_ENV=production with a
 * real production deployment. Next.js production builds use NODE_ENV=production
 * in Vercel previews, CI screenshot runs, and local `next build` executions.
 * VERCEL_ENV is the deployment authority when present.
 */
function resolveDeploymentEnvironment(env = process.env) {
  const vercelEnvironment = String(env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (["production", "preview", "development"].includes(vercelEnvironment)) {
    return vercelEnvironment;
  }

  if (String(env.CI ?? "").toLowerCase() === "true") return "ci";
  if (env.NODE_ENV === "production") return "local-build";
  return env.NODE_ENV || "development";
}

function resolveBuildSha(env = process.env) {
  return String(env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? "")
    .trim()
    .slice(0, 8) || "unavailable";
}

function deploymentEnvironmentLabel(environment) {
  switch (environment) {
    case "production":
      return "Production deployment";
    case "preview":
      return "Preview deployment";
    case "ci":
      return "CI validation build";
    case "local-build":
      return "Local production-mode build";
    case "development":
      return "Development environment";
    default:
      return `${String(environment || "unknown")} environment`;
  }
}

module.exports = {
  resolveDeploymentEnvironment,
  resolveBuildSha,
  deploymentEnvironmentLabel,
};
