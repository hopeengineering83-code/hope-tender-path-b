export type LoginPublicErrorCode =
  | "INVALID_CREDENTIALS"
  | "MISSING_CREDENTIALS"
  | "INVALID_LOGIN_REQUEST"
  | "AUTH_SERVICE_UNAVAILABLE"
  | "AUTH_DATABASE_SCHEMA_OUTDATED"
  | "LOGIN_RATE_LIMITED";

const LOGIN_PUBLIC_MESSAGES: Record<LoginPublicErrorCode, string> = {
  INVALID_CREDENTIALS: "The email or password is incorrect.",
  MISSING_CREDENTIALS: "Enter both email and password.",
  INVALID_LOGIN_REQUEST: "The sign-in request was invalid. Please try again.",
  AUTH_SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again shortly.",
  AUTH_DATABASE_SCHEMA_OUTDATED: "Sign-in is unavailable because the database is behind this deployment. The pending database migrations must be applied \u2014 retrying will not clear this.",
  LOGIN_RATE_LIMITED: "Too many sign-in attempts. Wait briefly, then try again.",
};

export function isLoginPublicErrorCode(value: string | null | undefined): value is LoginPublicErrorCode {
  return Boolean(value && Object.prototype.hasOwnProperty.call(LOGIN_PUBLIC_MESSAGES, value));
}

export function LoginRecoveryNote({
  errorCode,
  recovered,
}: {
  errorCode?: LoginPublicErrorCode | null;
  recovered?: boolean;
}) {
  if (!errorCode && !recovered) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-800">
      <p className="font-semibold">Sign-in notice</p>
      {errorCode ? <p className="mt-1">{LOGIN_PUBLIC_MESSAGES[errorCode]}</p> : null}
      {recovered ? (
        <p className="mt-1">
          The sign-in page was refreshed after a browser recovery. Enter your credentials again.
        </p>
      ) : null}
    </div>
  );
}
