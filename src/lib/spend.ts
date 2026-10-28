// Paid vs used. Card bills and Monthly Allocation go by the day you paid.
// Spending (the Need/Want split, category totals) goes by the days you use it:
// a 10-week coffee voucher counts a little each week, a trip counts while you're on it.
import type { Expense, FxRate } from './types';
import { ratesFrom, toHkd } from './fx';
import { monthKey } from './format';

const DAY = 86_400_000;
const t = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** True when the expense is used over a stretch of days rather than on the day it was paid. */
export const spread = (e: Expense) => !!(e.use_from && e.use_to);

/** Share (0 to 1) of an expense that's used in a month. */
export function shareIn(e: Expense, month: string): number {
  if (!spread(e)) return e.budget_month === month ? 1 : 0;
  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1); // exclusive
  const from = t(e.use_from!);
  const to = t(e.use_to!) + DAY; // the last day counts
  const overlap = Math.max(0, Math.min(end, to) - Math.max(start, from));
  return overlap / (to - from);
}

/** Months an expense is used in, e.g. ['2027-08-01', '2027-09-01']. */
export function usedMonths(e: Expense): string[] {
  if (!spread(e)) return [e.budget_month];
  const out: string[] = [];
  let [y, m] = e.use_from!.split('-').map(Number);
  const last = e.use_to!.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const k = monthKey(y, m - 1);
    out.push(k);
    if (k.slice(0, 7) >= last) break;
    m += 1;
  }
  return out;
}

/** HKD value of an expense at the rate of the month it was paid (what it actually cost). */
export function makeHkdOf(fx: FxRate[]) {
  const cache = new Map<string, Record<string, number>>();
  const latest = ratesFrom(fx);
  const ratesAt = (month: string) => {
    if (!cache.has(month)) {
      const r = ratesFrom(fx.filter((f) => f.month <= month));
      cache.set(month, { ...latest, ...r });
    }
    return cache.get(month)!;
  };
  return (e: Expense) => {
    const amt = Number(e.charged_amount ?? e.amount);
    const cur = e.charged_amount != null ? e.charged_currency ?? e.currency : e.currency;
    return toHkd(amt, cur, ratesAt(e.budget_month));
  };
}

/** "Aug – Sep 2027", "25 Aug – 10 Sep 2027", or "28 Oct – 6 Jan 2027". */
export function rangeLabel(from: string, to: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = (iso: string) => `${Number(iso.slice(8, 10))} ${M[Number(iso.slice(5, 7)) - 1]}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (from === to) return `${d(from)} ${from.slice(0, 4)}`;
  return `${d(from)}${sameYear ? '' : ' ' + from.slice(0, 4)} – ${d(to)} ${to.slice(0, 4)}`;
}
