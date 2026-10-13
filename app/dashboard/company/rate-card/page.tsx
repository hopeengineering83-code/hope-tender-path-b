import { PricingRateCardManager } from "../../../../components/pricing-rate-card-manager";

export default function CompanyRateCardPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Company Vault</p>
        <h1 className="text-2xl font-bold text-slate-900">Pricing rate card</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          The firm&apos;s own rates, entered once and reused by Pricing Intelligence on every tender. Each rate keeps its source and date, and old rates are flagged before they reach a price.
        </p>
      </div>
      <PricingRateCardManager />
    </div>
  );
}
