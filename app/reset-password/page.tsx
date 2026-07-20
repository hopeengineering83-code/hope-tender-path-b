"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRightIcon } from "../../components/icons";

function ResetForm() {
  const params = useSearchParams();
  // The server's emailed reset links are token-only
  // (forgot-password/route.ts builds reset-password?token=...), and the
  // reset API consumes { token, password } — requiring a second query
  // param here made every real emailed link land on a disabled form.
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) setError("Invalid or missing reset link. Request a new one.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Reset failed"); return; }
      setDone(true);
    } catch {
      setError("Request failed. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800">
          Password updated successfully.
        </div>
        <Link href="/login" className="block text-sm font-medium text-slate-900 hover:underline">
          Sign in with your new password <ArrowRightIcon />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">New password</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Confirm new password</label>
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
          placeholder="Repeat new password"
        />
      </div>
      <button
        type="submit"
        disabled={loading || !token}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {loading ? "Updating…" : "Set New Password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white text-xl mb-4">
            H
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hope Tender</h1>
          <p className="mt-1 text-sm text-slate-500">Hope Urban Planning Architectural and Engineering Consultancy</p>
        </div>
        <div className="space-y-6 rounded-2xl border bg-white p-8 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Set new password</h2>
            <p className="mt-0.5 text-sm text-slate-500">Choose a strong password for your account.</p>
          </div>
          <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
            <ResetForm />
          </Suspense>
          <p className="text-center text-sm text-slate-500">
            <Link href="/login" className="font-medium text-slate-900 hover:underline">Back to sign in</Link>
          </p>
        </div>
        <p className="text-center text-xs text-slate-400">
          AI-powered tender proposal generation &amp; compliance engine
        </p>
      </div>
    </div>
  );
}
