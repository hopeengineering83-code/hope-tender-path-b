"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ note: string } | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Request failed"); return; }
      setResult(data);
    } catch {
      setError("Request failed. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reset password</h1>
          <p className="mt-1 text-sm text-slate-500">Enter your account email to request password reset instructions.</p>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Generating…" : "Request reset instructions"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {result.note}
            </div>

          </div>
        )}

        <p className="text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-slate-900 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
