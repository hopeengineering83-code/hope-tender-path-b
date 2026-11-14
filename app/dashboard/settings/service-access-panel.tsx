"use client";

// Owner control for read-only service access (first client: HOPE ONE AGENT). A grant lets that
// client read the minimal status of THIS account's tenders (titles, references, stages,
// deadlines, readiness, job states) — never client details, pricing, files or documents, and it
// can never run AI Analyze, Run Engine or change anything. The token is shown once.
import { useCallback, useEffect, useState } from "react";

type Grant = {
  id: string; label: string | null; audience: string; scope: string; createdAt: string; expiresAt: string;
  revokedAt: string | null; lastUsedAt: string | null; useCount: number; active: boolean;
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "never";
}

export default function ServiceAccessPanel() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [days, setDays] = useState(30);
  const [label, setLabel] = useState("HOPE ONE AGENT");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/service-grants", { cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setError("Only an administrator or proposal manager can manage service access.");
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (Array.isArray(data.grants)) setGrants(data.grants);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function issue() {
    setBusy(true); setError(null); setMessage(null); setToken(null);
    try {
      const response = await fetch("/api/settings/service-grants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, days }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || "Could not issue the grant."); return; }
      setToken(data.token);
      setMessage("Grant issued. Copy the token now and paste it into HOPE ONE AGENT → Setup. It is shown only once.");
      await load();
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this grant? HOPE ONE AGENT loses access on its next request.")) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/settings/service-grants/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || "Could not revoke the grant."); return; }
      setToken(null);
      setMessage("Grant revoked.");
      await load();
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm" aria-labelledby="service-access-heading">
      <div>
        <h2 id="service-access-heading" className="font-semibold text-slate-900">Service access (read-only)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Let HOPE ONE AGENT read the status of your tenders: titles, references, stages, deadlines, readiness and
          job states. It never sees client details, pricing, files or documents, and it can never run AI Analyze,
          Run Engine or change anything. Grants expire (at most 90 days) and can be revoked at any time.
        </p>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {token && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Token (shown once)</p>
          <code className="block break-all rounded bg-white p-2 text-xs text-slate-900" data-testid="service-token">{token}</code>
          <button type="button" className="min-h-11 rounded-lg border px-4 text-sm"
                  onClick={() => { void navigator.clipboard?.writeText(token); setMessage("Token copied."); }}>
            Copy token
          </button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-sm font-medium text-slate-800">Label
          <input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)}
                 className="mt-1 block min-h-11 w-full rounded-lg border px-3" />
        </label>
        <label className="text-sm font-medium text-slate-800">Valid for
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}
                  className="mt-1 block min-h-11 rounded-lg border px-3">
            <option value={7}>7 days</option><option value={30}>30 days</option>
            <option value={60}>60 days</option><option value={90}>90 days</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void issue()}
                className="min-h-11 rounded-lg bg-black px-5 text-sm font-medium text-white disabled:opacity-60">
          Issue read-only grant
        </button>
      </div>
      <ul className="divide-y rounded-xl border" aria-label="Service grants">
        {grants.length === 0 && <li className="p-3 text-sm text-slate-500">No grants yet.</li>}
        {grants.map((grant) => (
          <li key={grant.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              <span className="font-medium text-slate-900">{grant.label || "Service grant"}</span>{" "}
              <span className={grant.active ? "text-emerald-700" : "text-slate-500"}>
                {grant.active ? "active" : grant.revokedAt ? "revoked" : "expired"}
              </span>
              <span className="block text-xs text-slate-500">
                Expires {when(grant.expiresAt)} · last used {when(grant.lastUsedAt)} · {grant.useCount} use(s)
              </span>
            </span>
            {grant.active && (
              <button type="button" disabled={busy} onClick={() => void revoke(grant.id)}
                      className="min-h-11 rounded-lg border border-red-300 px-4 text-red-700">Revoke</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
