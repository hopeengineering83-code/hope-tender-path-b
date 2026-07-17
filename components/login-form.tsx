"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const DB_RETRY_COUNTDOWN_S = 8;

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDbError, setIsDbError] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const submitRef = useRef<(() => void) | null>(null);

  // Auto-retry countdown when DB wakeup is in progress.
  useEffect(() => {
    if (!isDbError || retryCountdown <= 0) return;
    const t = setTimeout(() => {
      if (retryCountdown === 1) {
        // Countdown reached zero — fire the retry.
        setRetryCountdown(0);
        submitRef.current?.();
      } else {
        setRetryCountdown((c) => c - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [isDbError, retryCountdown]);

  async function doLogin() {
    setLoading(true);
    setError("");
    setIsDbError(false);
    setRetryCountdown(0);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await res.json().catch(() => null) as { error?: string; detail?: string } | null;

      if (res.ok) {
        window.location.href = "/dashboard";
        return;
      }

      if (res.status === 503) {
        setIsDbError(true);
        setError("Database is waking up — retrying automatically in a moment.");
        setRetryCountdown(DB_RETRY_COUNTDOWN_S);
        return;
      }

      const detail = data?.detail ? ` — ${data.detail}` : "";
      setError(`${data?.error || "Login failed"}${detail}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // Keep submitRef in sync so the countdown closure can call the latest doLogin.
  submitRef.current = doLogin;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void doLogin();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
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
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="mb-2 block text-sm font-medium">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          className="w-full rounded-xl border px-4 py-3 outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-black px-4 py-3 text-white disabled:opacity-60"
      >
        {loading ? "Signing In..." : "Sign In"}
      </button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/forgot-password" className="hover:underline">Forgot password?</Link>
      </p>
    </form>
  );
}
