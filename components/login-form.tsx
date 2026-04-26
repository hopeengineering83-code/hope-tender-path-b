"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await res.json().catch(() => null) as { error?: string; detail?: string } | null;

      if (res.ok) {
        window.location.href = "/dashboard";
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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium">Email</label>
        <input
          type="email"
          className="w-full rounded-xl border px-4 py-3 outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Password</label>
        <input
          type="password"
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
    </form>
  );
}
