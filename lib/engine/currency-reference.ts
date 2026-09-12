/**
 * Generic currency reference.
 *
 * WHY THIS EXISTS
 * ---------------
 * The portfolio fact extractor recognised six currencies: ETB, GBP, USD, EUR,
 * KES and ZAR. Any amount denominated in anything else was read as no amount at
 * all, so a project in Nigeria, Rwanda, Vietnam, Peru or Jordan silently lost
 * its contract value even though the figure sat verbatim in the record's own
 * reference text. It is the same defect the country list had: a hand-written
 * regional list standing in for general knowledge, and a system that is meant
 * to work for any tender in any country quietly working for one region.
 *
 * ISO 4217 codes are matched case-sensitively in upper case. A few three-letter
 * codes are also ordinary English words when lower-cased ("all", "top", "try",
 * "pen"), and a currency only ever appears immediately beside a figure, so
 * requiring the code's real casing costs nothing and removes the whole class of
 * false positive. Symbols and currency names stay case-insensitive.
 *
 * Ambiguous currency NAMES are deliberately absent. "Shilling" could be KES,
 * UGX or TZS; "peso" could be any of eight; "kwacha" two. Naming no currency is
 * correct where naming the wrong one is a fabricated figure in a bid.
 */

/** ISO 4217 alphabetic codes in active use. */
const ISO_4217 = new Set<string>([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
  "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
  "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS",
  "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR",
  "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD",
  "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU",
  "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK",
  "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
  "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK",
  "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL",
  "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH",
  "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD",
  "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWL",
]);

/** Symbols and unambiguous currency names. Anything ambiguous is left out. */
const CURRENCY_ALIASES: ReadonlyArray<{ alias: string; code: string }> = [
  { alias: "$", code: "USD" },
  { alias: "US$", code: "USD" },
  { alias: "£", code: "GBP" },
  { alias: "€", code: "EUR" },
  { alias: "¥", code: "JPY" },
  { alias: "₹", code: "INR" },
  { alias: "₦", code: "NGN" },
  { alias: "₩", code: "KRW" },
  { alias: "₽", code: "RUB" },
  { alias: "Birr", code: "ETB" },
  { alias: "Naira", code: "NGN" },
  { alias: "Rand", code: "ZAR" },
  { alias: "Cedi", code: "GHS" },
  { alias: "Cedis", code: "GHS" },
  { alias: "Dong", code: "VND" },
  { alias: "Baht", code: "THB" },
  { alias: "Ringgit", code: "MYR" },
  { alias: "Rupiah", code: "IDR" },
  { alias: "Zloty", code: "PLN" },
  { alias: "Sterling", code: "GBP" },
];

const ALIAS_LOOKUP: ReadonlyMap<string, string> = new Map(
  CURRENCY_ALIASES.map((entry) => [entry.alias.toLowerCase(), entry.code] as const),
);

/**
 * The ISO code a matched token denotes, or null when the token denotes no
 * single currency. Codes must arrive in upper case; symbols and names may
 * arrive in any case.
 */
export function resolveCurrencyToken(token: string | null | undefined): string | null {
  const raw = (token ?? "").trim();
  if (!raw) return null;
  if (/^[A-Z]{3}$/.test(raw) && ISO_4217.has(raw)) return raw;
  return ALIAS_LOOKUP.get(raw.toLowerCase()) ?? null;
}

export function isKnownCurrencyCode(code: string | null | undefined): boolean {
  return typeof code === "string" && ISO_4217.has(code);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regex alternation matching any currency token, longest alias first.
 *
 * Built once and shared so every amount pattern in the codebase recognises the
 * same set of currencies. Three-letter codes appear as a case-sensitive class;
 * callers must therefore NOT apply the `i` flag to a pattern built from this,
 * or "1,000 all of which" becomes a thousand Albanian lek.
 */
export const CURRENCY_TOKEN_ALTERNATION: string = (() => {
  const aliases = CURRENCY_ALIASES.map((entry) => entry.alias)
    .sort((a, b) => b.length - a.length)
    .map((alias) => {
      const escaped = escapeRegExp(alias);
      // Letter-based names need case-insensitivity of their own since the
      // pattern as a whole is case-sensitive.
      return /^[A-Za-z]/.test(alias)
        ? escaped
            .split("")
            .map((ch) => (/[A-Za-z]/.test(ch) ? `[${ch.toUpperCase()}${ch.toLowerCase()}]` : ch))
            .join("")
        : escaped;
    });
  const codes = [...ISO_4217].sort().join("|");
  return `(?:${codes}|${aliases.join("|")})`;
})();
