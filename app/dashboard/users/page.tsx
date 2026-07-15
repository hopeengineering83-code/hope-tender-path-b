"use client";

import { useCallback, useEffect, useState } from "react";

type User = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
};

type UsersResponse = { users?: User[]; error?: string };

const ROLES = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: "bg-red-100 text-red-700",
  PROPOSAL_MANAGER: "bg-blue-100 text-blue-700",
  REVIEWER: "bg-amber-100 text-amber-700",
  VIEWER: "bg-slate-100 text-slate-600",
};

function roleLabel(role: string) {
  return role.replaceAll("_", " ");
}

async function readResponse(response: Response): Promise<UsersResponse> {
  return response.json().catch(() => ({})) as Promise<UsersResponse>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "PROPOSAL_MANAGER" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editName, setEditName] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/users", { cache: "no-store" });
    const data = await readResponse(response);
    if (!response.ok) {
      throw new Error(response.status === 403 ? "Access denied." : data.error ?? `Users could not be loaded (HTTP ${response.status}).`);
    }
    setUsers(data.users ?? []);
    return data.users ?? [];
  }, []);

  useEffect(() => {
    setError(null);
    void load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Users could not be loaded."))
      .finally(() => setLoading(false));
  }, [load]);

  async function createUser() {
    setFormError(null);
    setError(null);
    setStatus(null);
    if (!form.email.trim() || !form.password) {
      setFormError("Email and password are required.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, email: form.email.trim() }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.error ?? `User could not be created (HTTP ${response.status}).`);
      await load();
      setForm({ name: "", email: "", password: "", role: "PROPOSAL_MANAGER" });
      setShowCreate(false);
      setStatus("User created and confirmed in the refreshed user list.");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "User could not be created.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user: User) {
    setError(null);
    setStatus(null);
    setEditId(user.id);
    setEditRole(user.role);
    setEditName(user.name ?? "");
  }

  async function saveEdit(user: User) {
    setError(null);
    setStatus(null);
    setUpdatingId(user.id);
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, role: editRole }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.error ?? `User could not be updated (HTTP ${response.status}).`);
      await load();
      setEditId(null);
      setStatus(`${user.email} updated and confirmed in the refreshed user list.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "User could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteUser(user: User) {
    if (!window.confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    setError(null);
    setStatus(null);
    setDeletingId(user.id);
    try {
      const response = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.error ?? `User could not be deleted (HTTP ${response.status}).`);
      await load();
      if (editId === user.id) setEditId(null);
      setStatus(`${user.email} deleted and the user list was refreshed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "User could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  function UserActions({ user }: { user: User }) {
    const editing = editId === user.id;
    const updating = updatingId === user.id;
    const deleting = deletingId === user.id;
    const busy = updating || deleting;

    if (editing) {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => void saveEdit(user)} disabled={busy} className="min-h-11 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {updating ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditId(null)} disabled={busy} className="min-h-11 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-60">Cancel</button>
        </div>
      );
    }

    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => startEdit(user)} disabled={busy} className="min-h-11 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-slate-100 disabled:opacity-60">Edit</button>
        <button type="button" onClick={() => void deleteUser(user)} disabled={busy} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    );
  }

  if (loading) return <div role="status" className="p-8 text-slate-500">Loading users…</div>;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="mt-1 text-sm text-slate-500">Manage team access. Server confirmation is required before any action is reported as complete.</p>
        </div>
        <button type="button" onClick={() => { setShowCreate((value) => !value); setFormError(null); }} className="min-h-11 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 sm:w-auto">
          {showCreate ? "Close form" : "Invite user"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {status && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div>}

      {showCreate && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm" aria-busy={saving}>
          <h2 className="mb-4 font-semibold text-slate-800">New user</h2>
          {formError && <p role="alert" className="mb-3 text-sm text-red-600">{formError}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="min-h-11 min-w-0 rounded-lg border px-3 py-2 text-sm" placeholder="Full name (optional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <input className="min-h-11 min-w-0 rounded-lg border px-3 py-2 text-sm" placeholder="Email address" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <input className="min-h-11 min-w-0 rounded-lg border px-3 py-2 text-sm" placeholder="Password (minimum 8 characters)" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <select aria-label="Role" className="min-h-11 min-w-0 rounded-lg border bg-white px-3 py-2 text-sm" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
          </div>
          <div className="mt-4 grid gap-2 sm:flex">
            <button type="button" onClick={() => void createUser()} disabled={saving} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Creating…" : "Create user"}</button>
            <button type="button" onClick={() => { setShowCreate(false); setFormError(null); }} disabled={saving} className="min-h-11 rounded-lg border px-4 py-2 text-sm disabled:opacity-60">Cancel</button>
          </div>
        </section>
      )}

      <div className="space-y-3 md:hidden">
        {users.map((user) => {
          const editing = editId === user.id;
          return (
            <article key={user.id} className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm" aria-busy={updatingId === user.id || deletingId === user.id}>
              <div className="min-w-0">
                {editing ? (
                  <input aria-label={`Display name for ${user.email}`} className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm" value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Display name" />
                ) : (
                  <h2 className="break-words font-medium text-slate-900">{user.name || "(no name)"}</h2>
                )}
                <p className="mt-1 break-all text-xs text-slate-500">{user.email}</p>
              </div>
              <div className="mt-3">
                {editing ? (
                  <select aria-label={`Role for ${user.email}`} className="min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm" value={editRole} onChange={(event) => setEditRole(event.target.value)}>
                    {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                  </select>
                ) : (
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_COLORS[user.role as Role] ?? "bg-slate-100 text-slate-600"}`}>{roleLabel(user.role)}</span>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500">Joined {new Date(user.createdAt).toLocaleDateString()}</p>
              <div className="mt-4"><UserActions user={user} /></div>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border bg-white shadow-sm md:block">
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-4 py-3 font-medium">User</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 font-medium">Joined</th><th className="px-4 py-3 font-medium">Actions</th></tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => {
                const editing = editId === user.id;
                return (
                  <tr key={user.id} className="align-top hover:bg-slate-50" aria-busy={updatingId === user.id || deletingId === user.id}>
                    <td className="px-4 py-3">
                      {editing ? <input className="min-h-11 w-full max-w-xs rounded border px-3 py-2 text-sm" value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Display name" /> : <div><p className="font-medium text-slate-900">{user.name || "(no name)"}</p><p className="break-all text-xs text-slate-500">{user.email}</p></div>}
                    </td>
                    <td className="px-4 py-3">
                      {editing ? <select className="min-h-11 rounded border bg-white px-3 py-2 text-sm" value={editRole} onChange={(event) => setEditRole(event.target.value)}>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select> : <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_COLORS[user.role as Role] ?? "bg-slate-100 text-slate-600"}`}>{roleLabel(user.role)}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><UserActions user={user} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {users.length === 0 && <div className="rounded-2xl border bg-white py-12 text-center text-slate-500">No users found.</div>}

      <div className="rounded-xl border bg-slate-50 p-4 text-xs text-slate-600">
        <h2 className="mb-1 font-semibold text-slate-700">Role permissions</h2>
        <ul className="space-y-1">
          <li><span className="font-medium text-red-700">ADMIN</span> — full access, including user administration.</li>
          <li><span className="font-medium text-blue-700">PROPOSAL MANAGER</span> — manages tenders, analysis, generation, and export.</li>
          <li><span className="font-medium text-amber-700">REVIEWER</span> — reviews documents and adds comments.</li>
          <li><span className="font-medium text-slate-700">VIEWER</span> — read-only access.</li>
        </ul>
      </div>
    </div>
  );
}
