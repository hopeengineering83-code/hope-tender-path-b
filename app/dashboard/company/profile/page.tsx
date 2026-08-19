"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CompanyProfile = {
  name: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  description: string;
  profileSummary: string;
  serviceLines: string;
  sectors: string;
  knowledgeMode: string;
  gmName: string;
  gmTitle: string;
  gmLicense: string;
  licenseGrade: string;
  registrationNumber: string;
  tin: string;
  vat: string;
  foundingYear: string;
  headcount: string;
};

type CompanyResponse = Partial<Omit<CompanyProfile, "serviceLines" | "sectors" | "foundingYear" | "headcount">> & {
  serviceLines?: string[];
  sectors?: string[];
  foundingYear?: number | null;
  headcount?: number | null;
  error?: string;
};

const EMPTY_PROFILE: CompanyProfile = {
  name: "",
  legalName: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  description: "",
  profileSummary: "",
  serviceLines: "",
  sectors: "",
  knowledgeMode: "PROFILE_FIRST",
  gmName: "",
  gmTitle: "",
  gmLicense: "",
  licenseGrade: "",
  registrationNumber: "",
  tin: "",
  vat: "",
  foundingYear: "",
  headcount: "",
};

const inputClass = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
const labelClass = "mb-1 block text-sm font-semibold text-slate-700";
const helpClass = "mt-1 text-xs leading-5 text-slate-500";

function toProfile(data: CompanyResponse): CompanyProfile {
  return {
    name: data.name ?? "",
    legalName: data.legalName ?? "",
    email: data.email ?? "",
    phone: data.phone ?? "",
    website: data.website ?? "",
    address: data.address ?? "",
    description: data.description ?? "",
    profileSummary: data.profileSummary ?? "",
    serviceLines: Array.isArray(data.serviceLines) ? data.serviceLines.join(", ") : "",
    sectors: Array.isArray(data.sectors) ? data.sectors.join(", ") : "",
    knowledgeMode: data.knowledgeMode ?? "PROFILE_FIRST",
    gmName: data.gmName ?? "",
    gmTitle: data.gmTitle ?? "",
    gmLicense: data.gmLicense ?? "",
    licenseGrade: data.licenseGrade ?? "",
    registrationNumber: data.registrationNumber ?? "",
    tin: data.tin ?? "",
    vat: data.vat ?? "",
    foundingYear: data.foundingYear == null ? "" : String(data.foundingYear),
    headcount: data.headcount == null ? "" : String(data.headcount),
  };
}

function Field({
  id,
  label,
  help,
  children,
  wide = false,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {children}
      {help && <p id={`${id}-help`} className={helpClass}>{help}</p>}
    </div>
  );
}

export default function LabeledCompanyProfilePage() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const response = await fetch("/api/company", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as CompanyResponse;
        if (!response.ok) throw new Error(data.error ?? `Company profile could not be loaded (HTTP ${response.status}).`);
        if (!cancelled) setProfile(toProfile(data));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Company profile could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function update<K extends keyof CompanyProfile>(field: K, value: CompanyProfile[K]) {
    setProfile((current) => ({ ...current, [field]: value }));
    setStatus(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setStatus(null);

    if (!profile.name.trim()) {
      setError("Company name is required.");
      return;
    }
    const foundingYear = profile.foundingYear.trim() ? Number(profile.foundingYear) : null;
    const headcount = profile.headcount.trim() ? Number(profile.headcount) : null;
    if (foundingYear !== null && (!Number.isInteger(foundingYear) || foundingYear < 1800 || foundingYear > new Date().getFullYear())) {
      setError("Founding year must be a valid four-digit year.");
      return;
    }
    if (headcount !== null && (!Number.isInteger(headcount) || headcount < 0)) {
      setError("Permanent staff headcount must be zero or a positive whole number.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          serviceLines: profile.serviceLines.split(",").map((item) => item.trim()).filter(Boolean),
          sectors: profile.sectors.split(",").map((item) => item.trim()).filter(Boolean),
          foundingYear,
          headcount,
        }),
      });
      const data = await response.json().catch(() => ({})) as CompanyResponse;
      if (!response.ok) throw new Error(data.error ?? `Company profile could not be saved (HTTP ${response.status}).`);
      setProfile(toProfile(data));
      setStatus("Company profile saved and confirmed by the server.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Company profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status" className="py-16 text-center text-sm text-slate-500">Loading labeled company profile…</p>;

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Persistent field labels</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Company Profile Editor</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Every populated value keeps a visible label. Saving updates company facts only and does not approve tender claims, matching, generation, or export.</p>
        </div>
        <Link href="/dashboard/company" className="min-h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50">Back to Knowledge Vault</Link>
      </div>

      {error && <div role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {status && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div>}

      <form onSubmit={save} className="space-y-7 rounded-2xl border bg-white p-4 shadow-sm sm:p-6" aria-busy={saving}>
        <fieldset>
          <legend className="text-lg font-semibold text-slate-900">Company identity and contact</legend>
          <p className="mt-1 text-sm text-slate-500">Use exact values from official company records.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="profile-name" label="Company name *" wide>
              <input id="profile-name" value={profile.name} onChange={(event) => update("name", event.target.value)} required autoComplete="organization" className={inputClass} />
            </Field>
            <Field id="profile-legal-name" label="Legal registered name">
              <input id="profile-legal-name" value={profile.legalName} onChange={(event) => update("legalName", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-knowledge-mode" label="Knowledge mode">
              <select id="profile-knowledge-mode" value={profile.knowledgeMode} onChange={(event) => update("knowledgeMode", event.target.value)} className={inputClass}>
                <option value="PROFILE_FIRST">Mode A — Profile First</option>
                <option value="FULL_LIBRARY">Mode B — Full Document Library</option>
              </select>
            </Field>
            <Field id="profile-email" label="Contact email">
              <input id="profile-email" type="email" value={profile.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" className={inputClass} />
            </Field>
            <Field id="profile-phone" label="Phone number">
              <input id="profile-phone" type="tel" value={profile.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" className={inputClass} />
            </Field>
            <Field id="profile-website" label="Website URL">
              <input id="profile-website" type="url" value={profile.website} onChange={(event) => update("website", event.target.value)} autoComplete="url" className={inputClass} />
            </Field>
            <Field id="profile-address" label="Registered address" wide>
              <input id="profile-address" value={profile.address} onChange={(event) => update("address", event.target.value)} autoComplete="street-address" className={inputClass} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="border-t pt-6">
          <legend className="text-lg font-semibold text-slate-900">Proposal profile content</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="profile-description" label="Company description" wide>
              <textarea id="profile-description" rows={3} value={profile.description} onChange={(event) => update("description", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-summary" label="Reviewed profile summary" help="Used as source content during proposal drafting. Review extracted facts before saving." wide>
              <textarea id="profile-summary" rows={7} value={profile.profileSummary} onChange={(event) => update("profileSummary", event.target.value)} aria-describedby="profile-summary-help" className={inputClass} />
            </Field>
            <Field id="profile-service-lines" label="Service lines" help="Comma-separated, for example: Architecture, Urban Planning, Structural Engineering">
              <textarea id="profile-service-lines" rows={3} value={profile.serviceLines} onChange={(event) => update("serviceLines", event.target.value)} aria-describedby="profile-service-lines-help" className={inputClass} />
            </Field>
            <Field id="profile-sectors" label="Sectors" help="Comma-separated, for example: Infrastructure, Public Buildings, Water">
              <textarea id="profile-sectors" rows={3} value={profile.sectors} onChange={(event) => update("sectors", event.target.value)} aria-describedby="profile-sectors-help" className={inputClass} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="border-t pt-6">
          <legend className="text-lg font-semibold text-slate-900">Authorising representative and institutional details</legend>
          <p className="mt-1 text-sm text-slate-500">Used in eligibility declarations, cover pages, company background, and corporate information.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="profile-gm-name" label="Authorising representative name">
              <input id="profile-gm-name" value={profile.gmName} onChange={(event) => update("gmName", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-gm-title" label="Authorising representative title">
              <input id="profile-gm-title" value={profile.gmTitle} onChange={(event) => update("gmTitle", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-gm-license" label="Representative license or registration">
              <input id="profile-gm-license" value={profile.gmLicense} onChange={(event) => update("gmLicense", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-license-grade" label="Company license grade or category">
              <input id="profile-license-grade" value={profile.licenseGrade} onChange={(event) => update("licenseGrade", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-registration" label="Business registration number" help="Use the exact value from official company registration documents.">
              <input id="profile-registration" value={profile.registrationNumber} onChange={(event) => update("registrationNumber", event.target.value)} aria-describedby="profile-registration-help" className={inputClass} />
            </Field>
            <Field id="profile-tin" label="Tax Identification Number (TIN)" help="Use the exact value from official TIN documents.">
              <input id="profile-tin" value={profile.tin} onChange={(event) => update("tin", event.target.value)} aria-describedby="profile-tin-help" className={inputClass} />
            </Field>
            <Field id="profile-vat" label="VAT registration number">
              <input id="profile-vat" value={profile.vat} onChange={(event) => update("vat", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-founding-year" label="Founding year">
              <input id="profile-founding-year" type="number" min="1800" max={new Date().getFullYear()} inputMode="numeric" value={profile.foundingYear} onChange={(event) => update("foundingYear", event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-headcount" label="Permanent staff headcount">
              <input id="profile-headcount" type="number" min="0" step="1" inputMode="numeric" value={profile.headcount} onChange={(event) => update("headcount", event.target.value)} className={inputClass} />
            </Field>
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row">
          <button type="submit" disabled={saving || !profile.name.trim()} className="min-h-11 rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving and confirming…" : "Save labeled company profile"}
          </button>
          <Link href="/dashboard/company" className="min-h-11 rounded-lg border border-slate-300 px-6 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
