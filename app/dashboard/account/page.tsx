"use client";
import { useState, useEffect } from "react";

type Me = { id: string; name: string | null; email: string; role: string };

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d: Me) => {
      setMe(d);
      setName(d.name ?? "");
    });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setProfileSaving(true);
    setProfileMsg("");
    setProfileError("");
    try {
      const res = await fetch(`/api/users/${me.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setProfileError(data.error ?? "Update failed"); return; }
      setMe((prev) => prev ? { ...prev, name: name.trim() } : prev);
      setProfileMsg("Profile updated.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    if (newPassword !== confirmPassword) { setPasswordError("Passwords do not match"); return; }
    if (newPassword.length < 8) { setPasswordError("Password must be at least 8 characters"); return; }
    setPasswordSaving(true);
    setPasswordMsg("");
    setPasswordError("");
    try {
      const res = await fetch(`/api/users/${me.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setPasswordError(data.error ?? "Password change failed"); return; }
      setPasswordMsg("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!me) return <p className="text-slate-400 py-12 text-center">Loading…</p>;

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Account</h1>
        <p className="mt-0.5 text-sm text-slate-500">Manage your name and password.</p>
      </div>

      {/* Profile info */}
      <section className="rounded-2xl border bg-white p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Profile</h2>
          <p className="text-xs text-slate-400 mt-0.5">Role: <span className="font-medium text-slate-600">{me.role.replaceAll("_", " ")}</span></p>
        </div>

        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Email (read-only)</p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">{me.email}</p>
        </div>

        <form onSubmit={saveProfile} className="space-y-4">
          {profileError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{profileError}</div>}
          {profileMsg && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{profileMsg}</div>}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="Your name"
            />
          </div>
          <button
            type="submit"
            disabled={profileSaving}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {profileSaving ? "Saving…" : "Save Profile"}
          </button>
        </form>
      </section>

      {/* Password change */}
      <section className="rounded-2xl border bg-white p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-900">Change Password</h2>
        <form onSubmit={changePassword} className="space-y-4">
          {passwordError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{passwordError}</div>}
          {passwordMsg && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{passwordMsg}</div>}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={passwordSaving}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {passwordSaving ? "Updating…" : "Change Password"}
          </button>
        </form>
      </section>
    </div>
  );
}
