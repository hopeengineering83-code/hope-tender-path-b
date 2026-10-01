"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const DB_RETRY_COUNTDOWN_S = 8;

const PUBLIC_LOGIN_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "The email or password is incorrect.",
  MISSING_CREDENTIALS: "Enter both email and password.",
  INVALID_LOGIN_REQUEST: "The sign-in request was invalid. Please try again.",
  AUTH_SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again shortly.",
  AUTH_DATABASE_SCHEMA_OUTDATED: "Sign-in is unavailable because the database is behind this deployment. The pending database migrations must be applied \u2014 retrying will not clear this.",
  LOGIN_RATE_LIMITED: "Too many sign-in attempts. Wait briefly, then try again.",
};

/**
 * 503 codes that retrying cannot clear.
 *
 * The countdown below exists for a database that is briefly unreachable, where
 * waiting genuinely helps. A schema that is behind the deployment is not that:
 * every retry re-runs the same query against the same missing column. A live
 * preview sat in exactly this state, counting down and resubmitting on a loop,
 * because this component mapped ANY 503 to "temporarily unavailable" and threw
 * away the specific code the server had already worked out.
 */
const NON_RETRYABLE_503_CODES = new Set(["AUTH_DATABASE_SCHEMA_OUTDATED"]);

function publicLoginMessage(code: string | undefined, status: number): string {
  if (code && PUBLIC_LOGIN_ERRORS[code]) return PUBLIC_LOGIN_ERRORS[code];
  if (status === 503) return PUBLIC_LOGIN_ERRORS.AUTH_SERVICE_UNAVAILABLE;
  if (status === 429) return PUBLIC_LOGIN_ERRORS.LOGIN_RATE_LIMITED;
  if (status === 401) return PUBLIC_LOGIN_ERRORS.INVALID_CREDENTIALS;
  return "Sign-in failed. Please try again.";
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDbError, setIsDbError] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const submitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isDbError || retryCountdown <= 0) return;
    const timer = setTimeout(() => {
      if (retryCountdown === 1) {
        setRetryCountdown(0);
        submitRef.current?.();
      } else {
        setRetryCountdown((current) => current - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [isDbError, retryCountdown]);

  async function doLogin() {
    setLoading(true);
    setError("");
    setIsDbError(false);
    setRetryCountdown(0);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await response.json().catch(() => null) as { code?: string } | null;

      if (response.ok) {
        window.location.replace("/dashboard");
        return;
      }

      if (response.status === 503) {
        const retryable = !(data?.code && NON_RETRYABLE_503_CODES.has(data.code));
        setIsDbError(retryable);
        setError(publicLoginMessage(data?.code, response.status));
        if (retryable) setRetryCountdown(DB_RETRY_COUNTDOWN_S);
        return;
      }

      setError(publicLoginMessage(data?.code, response.status));
    } catch {
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  submitRef.current = doLogin;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void doLogin();
  }

  return (
    <form
      action="/api/auth/login"
      method="post"
      acceptCharset="UTF-8"
      onSubmit={handleSubmit}
      className="space-y-5"
      data-auth-form="safe-post"
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700" role="alert">
          <p>{error}</p>
          {isDbError && retryCountdown > 0 && (
            <p className="mt-1 text-xs text-red-600">
              Retrying in {retryCountdown}s…{" "}
              <button
                type="button"
                onClick={() => { setRetryCountdown(0); void doLogin(); }}
                className="font-medium underline hover:text-red-900"
              >
                Retry now
              </button>
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="login-email" className="mb-2 block text-sm font-medium">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          className="w-full rounded-xl border px-4 py-3 outline-none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div>
        <label htmlFor="login-password" className="mb-2 block text-sm font-medium">Password</label>
        <div className="relative">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            className="w-full rounded-xl border px-4 py-3 pr-12 outline-none"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-slate-600 hover:text-slate-900"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-black px-4 py-3 text-white disabled:opacity-60"
      >
        {loading ? "Signing In..." : "Sign In"}
      </button>

      <p className="text-center text-sm text-slate-700">
        <Link href="/forgot-password" className="hover:underline">Forgot password?</Link>
      </p>
    </form>
  );
}
