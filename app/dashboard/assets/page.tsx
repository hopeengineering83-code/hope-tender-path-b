export default function AssetsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Assets Manager</h1>
        <p className="mt-1 text-sm text-slate-500">
          Letterhead, logo, signature, stamp, and branding rules will be maintained here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          This module is prepared for brand asset uploads, default asset selection, and allowed or disallowed
          usage rules during tender generation.
        </p>
      </div>
    </div>
  );
}
