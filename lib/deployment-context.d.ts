export type DeploymentEnvironment =
  | "production"
  | "preview"
  | "development"
  | "ci"
  | "local-build"
  | string;

export function resolveDeploymentEnvironment(
  env?: Record<string, string | undefined>,
): DeploymentEnvironment;

export function resolveBuildSha(
  env?: Record<string, string | undefined>,
): string;

export function deploymentEnvironmentLabel(
  environment: DeploymentEnvironment,
): string;
