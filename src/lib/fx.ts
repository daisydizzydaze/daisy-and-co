// Free daily exchange rates (no key needed), with a mirror as fallback.
// https://github.com/fawazahmed0/exchange-api
const SOURCES = [
  (date: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/hkd.json`,
  (date: string) => `https://${date}.currency-api.pages.dev/v1/currencies/hkd.json`,
];

/** The day to price a budget month at: its last day, or today if the month hasn't ended yet. */
export function rateDate(month: string, today = new Date()): string {
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0));
  const t = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  return (end < t ? end : t).toISOString().slice(0, 10);
}

/** Returns how many HKD one unit of each currency is worth on that day. */
export async function fetchRatesToHkd(date: string, currencies: string[]): Promise<Record<string, number>> {
  let lastError: unknown;
  for (const src of SOURCES) {
    for (const d of [date, 'latest']) {
      try {
        const res = await fetch(src(d));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { hkd: Record<string, number> };
        const out: Record<string, number> = {};
        for (const c of currencies) {
          const perHkd = body.hkd[c.toLowerCase()];
          if (perHkd > 0) out[c] = Math.round((1 / perHkd) * 1e4) / 1e4;
        }
        return out;
      } catch (e) {
        lastError = e;
      }
    }
  }
  throw new Error(`Couldn't fetch exchange rates (${(lastError as Error)?.message ?? 'offline'})`);
}

/** Latest rate on or before the month for each currency (fx is newest first). HKD is 1. */
export function ratesFrom(fx: { currency: string; rate_to_hkd: number }[]): Record<string, number> {
  const rates: Record<string, number> = { HKD: 1 };
  fx.forEach((f) => { if (!(f.currency in rates)) rates[f.currency] = Number(f.rate_to_hkd); });
  return rates;
}

export function toHkd(amount: number, currency: string, rates: Record<string, number>): number | null {
  const r = rates[currency];
  return r ? amount * r : null;
}

/** What a charge cost in the card's own currency (the billed amount if known). */
export function inCardCurrency(
  e: { amount: number; currency: string; charged_amount: number | null; charged_currency: string | null },
  cardCurrency: string,
  rates: Record<string, number>,
): number | null {
  const amt = Number(e.charged_amount ?? e.amount);
  const cur = e.charged_amount != null ? e.charged_currency ?? cardCurrency : e.currency;
  if (cur === cardCurrency) return amt;
  const hkd = toHkd(amt, cur, rates);
  return hkd === null || !rates[cardCurrency] ? null : hkd / rates[cardCurrency];
}
