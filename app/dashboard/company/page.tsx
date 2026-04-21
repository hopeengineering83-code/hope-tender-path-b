"use client";

import { useEffect, useState } from "react";

type Company = {
  id?: string; name: string; description: string; website: string;
  address: string; phone: string; email: string;
};

const empty: Company = { name: "", description: "", website: "", address: "", phone: "", email: "" };

export default function CompanyPage() {
  const [company, setCompany] = useState<Company>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/company")
      .then((r) => r.json())
      .then((d) => { if (d) setCompany({ ...empty, ...d }); })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      if (!res.ok) { setError("Failed to save"); return; }
      const updated = await res.json();
      setCompany({ ...empty, ...updated });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;

  const fields: { key: keyof Company; label: string; type?: string; placeholder?: string }[] = [
    { key: "name", label: "Company Name *", placeholder: "Hope Engineering Ltd" },
    { key: "description", label: "Description", placeholder: "Brief description of your company" },
    { key: "email", label: "Email", type: "email", placeholder: "contact@company.com" },
    { key: "phone", label: "Phone", placeholder: "+1 234 567 8900" },
    { key: "website", label: "Website", type: "url", placeholder: "https://company.com" },
    { key: "address", label: "Address", placeholder: "123 Main St, City, Country" },
  ];

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Company Vault</h1>
        <p className="text-gray-500 mt-1">Your company profile used across all tenders.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-6 space-y-5">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
        {success && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">Company profile saved.</div>}

        {fields.map(({ key, label, type = "text", placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            {key === "description" ? (
              <textarea
                rows={3}
                value={company[key]}
                onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none"
              />
            ) : (
              <input
                type={type}
                value={company[key]}
                onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
              />
            )}
          </div>
        ))}

        <button type="submit" disabled={saving || !company.name}
          className="bg-black text-white px-6 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Saving..." : "Save Company Profile"}
        </button>
      </form>
    </div>
  );
}
