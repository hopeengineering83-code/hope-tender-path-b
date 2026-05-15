type AIHealthResponse = {
  success: boolean;
  preferredProvider: string;
  nextAction: string;
  blockers: string[];
  warnings: string[];
  providers: {
    claude: { configured: boolean; tier: string | null; proposalModels: string[]; maxOutputTokens: number | null };
    gemini: { configured: boolean; primaryModel: string; fallbackModels: string[]; extractionModel: string | null };
    openai: { configured: boolean; note: string };
  };
};

async function getAIHealth(): Promise<AIHealthResponse | null> {
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/ai/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json() as AIHealthResponse;
  } catch {
    return null;
  }
}

function statusPill(configured: boolean) {
  return configured
    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Configured</span>
    : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Missing</span>;
}

export async function AIHealthPanel() {
  const health = await getAIHealth();
  if (!health) {
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">AI health</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">AI health check unavailable</h2>
        <p className="mt-1 text-sm text-amber-800">The AI health endpoint could not be read. Check deployment/runtime logs before relying on AI analysis or proposal generation.</p>
      </section>
    );
  }

  const ok = health.success;
  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ok ? "text-emerald-700" : "text-red-700"}`}>AI provider health</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Preferred provider: {health.preferredProvider}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Shows whether Claude/Gemini keys and model chains are available before running AI Analyze, Run Engine, or Generate Docs.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{health.nextAction.replace(/_/g, " ")}</span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">Claude</p>{statusPill(health.providers.claude.configured)}</div>
          <p className="mt-2 text-xs text-slate-600">Tier: {health.providers.claude.tier ?? "not set"}</p>
          <p className="mt-1 text-xs text-slate-600">Models: {health.providers.claude.proposalModels.slice(0, 3).join(", ") || "none"}</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">Gemini</p>{statusPill(health.providers.gemini.configured)}</div>
          <p className="mt-2 text-xs text-slate-600">Primary: {health.providers.gemini.primaryModel}</p>
          <p className="mt-1 text-xs text-slate-600">Fallback: {health.providers.gemini.fallbackModels.slice(0, 2).join(", ") || "none"}</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">OpenAI</p>{statusPill(health.providers.openai.configured)}</div>
          <p className="mt-2 text-xs text-slate-600">{health.providers.openai.note}</p>
        </div>
      </div>

      {(health.blockers.length > 0 || health.warnings.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {health.blockers.length > 0 && <div className="rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800"><p className="font-semibold">Blockers</p><ul className="mt-2 list-disc pl-5">{health.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {health.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-800"><p className="font-semibold">Warnings</p><ul className="mt-2 list-disc pl-5">{health.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}
