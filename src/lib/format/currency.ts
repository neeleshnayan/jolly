/**
 * ONE table per currency — symbol, rough USD rate, and formatting habits.
 * Unlike skills, the currency universe is genuinely small (~30 codes cover
 * >99% of job posts), so a curated table IS the right shape — updating it is a
 * one-line edit here, and everything (ranking conversion, card display)
 * follows. Rates are deliberately rough constants for RANKING ONLY (is this
 * comp above/below the user's floor?) — never shown as conversions, never an
 * exchange desk. Revisit yearly or when a rate drifts >20%.
 */

type CurrencyInfo = {
  symbol: string;
  usd: number; // 1 unit ≈ this many USD (rough, ranking only)
  lakhs?: boolean; // format 3500000 as ₹35L
  bigUnit?: boolean; // low-value currencies (JPY/KRW/IDR/VND) format in millions
};

export const CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { symbol: "$", usd: 1 },
  EUR: { symbol: "€", usd: 1.08 },
  GBP: { symbol: "£", usd: 1.27 },
  INR: { symbol: "₹", usd: 1 / 85, lakhs: true },
  SGD: { symbol: "S$", usd: 0.74 },
  AED: { symbol: "AED ", usd: 0.27 },
  AUD: { symbol: "A$", usd: 0.66 },
  CAD: { symbol: "C$", usd: 0.73 },
  CHF: { symbol: "CHF ", usd: 1.12 },
  JPY: { symbol: "¥", usd: 1 / 155, bigUnit: true },
  CNY: { symbol: "CN¥", usd: 0.14 },
  SEK: { symbol: "SEK ", usd: 0.095 },
  NOK: { symbol: "NOK ", usd: 0.093 },
  DKK: { symbol: "DKK ", usd: 0.145 },
  PLN: { symbol: "zł", usd: 0.25 },
  CZK: { symbol: "Kč", usd: 0.043 },
  RON: { symbol: "RON ", usd: 0.22 },
  BRL: { symbol: "R$", usd: 0.18 },
  MXN: { symbol: "MX$", usd: 0.055 },
  NZD: { symbol: "NZ$", usd: 0.61 },
  HKD: { symbol: "HK$", usd: 0.13 },
  KRW: { symbol: "₩", usd: 1 / 1350, bigUnit: true },
  ILS: { symbol: "₪", usd: 0.27 },
  ZAR: { symbol: "R", usd: 0.055 },
  IDR: { symbol: "Rp", usd: 1 / 16000, bigUnit: true },
  MYR: { symbol: "RM", usd: 0.22 },
  THB: { symbol: "฿", usd: 0.028 },
  PHP: { symbol: "₱", usd: 0.017 },
  VND: { symbol: "₫", usd: 1 / 25000, bigUnit: true },
  TRY: { symbol: "₺", usd: 0.03 },
};

// symbols/aliases the extraction occasionally emits instead of clean ISO
const CUR_ALIAS: Record<string, string> = {
  "₹": "INR", RS: "INR", RUPEES: "INR",
  $: "USD", US$: "USD", "£": "GBP", "€": "EUR",
  S$: "SGD", A$: "AUD", C$: "CAD", "¥": "JPY", DHS: "AED", DIRHAM: "AED",
};

/** Normalise whatever the model emitted to an ISO code, or null. */
export function normCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = String(raw).trim().toUpperCase();
  if (CURRENCIES[k]) return k;
  return CUR_ALIAS[k] ?? null;
}

/** Rough USD value for RANKING comparisons only. Null when currency unknown. */
export function toUSD(amount: number, currency: string | null | undefined): number | null {
  const iso = normCurrency(currency);
  return iso ? amount * CURRENCIES[iso].usd : null;
}

/** "₹35L", "$300k", "S$180k", "¥12M" — one number, currency-aware habits. */
export function fmtMoney(n: number, currency: string | null | undefined): string {
  const iso = normCurrency(currency);
  const info = iso ? CURRENCIES[iso] : null;
  const sym = info?.symbol ?? "";
  if (info?.lakhs) return n >= 100000 ? `${sym}${Math.round(n / 100000)}L` : `${sym}${Math.round(n / 1000)}k`;
  if (info?.bigUnit && n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  return n >= 1000 ? `${sym}${Math.round(n / 1000)}k` : `${sym}${n}`;
}
