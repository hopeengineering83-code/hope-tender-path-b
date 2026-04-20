"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        window.location.href = "/dashboard";
        return;
      }

      const data = await res.json().catch(() => null);
      alert(data?.error || "Login failed");
    } catch {
      alert("Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
