"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
};

const ROLES = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: "bg-red-100 text-red-700",
  PROPOSAL_MANAGER: "bg-blue-100 text-blue-700",
  REVIEWER: "bg-amber-100 text-amber-700",
  VIEWER: "bg-slate-100 text-slate-600",
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "PROPOSAL_MANAGER" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // edit inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>("");
  const [editName, setEditName] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        setError(res.status === 403 ? "Access denied" : "Failed to load users");
        return;
      }
      const data = await res.json() as { users: User[] };
      setUsers(data.users);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createUser() {
    setFormError("");
    if (!form.email || !form.password) {
      setFormError("Email and password required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setFormError(data.error ?? "Failed to create user"); return; }
      setForm({ name: "", email: "", password: "", role: "PROPOSAL_MANAGER" });
      setShowCreate(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, role: editRole }),
    });
    if (res.ok) { setEditId(null); await load(); }
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    await load();
  }

  function startEdit(user: User) {
    setEditId(user.id);
    setEditRole(user.role);
    setEditName(user.name ?? "");
  }

  if (loading) return <div className="p-8 text-slate-500">Loading users…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage team access. Admins can create users and assign roles.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Invite User
        </button>
      </div>

      {showCreate && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-800">New User</h2>
          {formError && <p className="mb-3 text-sm text-red-600">{formError}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-lg border px-3 py-2 text-sm"
              placeholder="Full name (optional)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm"
              placeholder="Email address *"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm"
              placeholder="Password (min 8 chars) *"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r.replaceAll("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={createUser}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create User"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setFormError(""); }}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium hidden sm:table-cell">Joined</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  {editId === user.id ? (
                    <input
                      className="rounded border px-2 py-1 text-sm w-full max-w-[200px]"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Display name"
                    />
                  ) : (
                    <div>
                      <p className="font-medium text-slate-900">{user.name || "(no name)"}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editId === user.id ? (
                    <select
                      className="rounded border px-2 py-1 text-xs"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r.replaceAll("_", " ")}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[user.role as Role] ?? "bg-slate-100 text-slate-600"}`}>
                      {user.role.replaceAll("_", " ")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {editId === user.id ? (
                    <div className="flex gap-1.5 justify-end">
                      <button
                        onClick={() => saveEdit(user.id)}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="rounded border px-2.5 py-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 justify-end">
                      <button
                        onClick={() => startEdit(user)}
                        className="rounded border px-2.5 py-1 text-xs hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteUser(user.id, user.email)}
                        className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="py-12 text-center text-slate-400">No users found</div>
        )}
      </div>

      <div className="rounded-xl bg-slate-50 border p-4 text-xs text-slate-500">
        <p className="font-semibold text-slate-700 mb-1">Role permissions</p>
        <ul className="space-y-0.5">
          <li><span className="font-medium text-red-700">ADMIN</span> — full access: manage users, company, tenders, generate, export</li>
          <li><span className="font-medium text-blue-700">PROPOSAL MANAGER</span> — manage tenders, run analysis, generate documents, export</li>
          <li><span className="font-medium text-amber-700">REVIEWER</span> — view all, approve/reject generated documents, add comments</li>
          <li><span className="font-medium text-slate-600">VIEWER</span> — read-only access to tenders and documents</li>
        </ul>
      </div>
    </div>
  );
}
