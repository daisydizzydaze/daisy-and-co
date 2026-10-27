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
