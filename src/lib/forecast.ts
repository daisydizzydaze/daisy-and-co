// Freedom date: when liquid money reaches the Freedom number at the current pace.
// Pace = what you pay yourself first into liquid accounts (Allocation's Growth lines).
// Everything is in today's money: the return is after inflation, so the target stays put.
import { supabase } from './supabase';
import { ratesAt } from './networth';
import { addMonths, defaultBudgetMonth, monthKey } from './format';
import type { Allocation, Bucket, FxRate, Tag } from './types';

export interface ForecastSettings {
  expected_return: number; // yearly, after inflation, e.g. 0.05
  birth_year: number | null;
  canSave: boolean; // false until migration 011 adds expected_return
}

export const DEFAULT_RETURN = 0.05;

export async function loadForecast(): Promise<{ settings: ForecastSettings; growth: Allocation[] }> {
  const [s, birth, growth] = await Promise.all([
    supabase.from('settings').select('expected_return').maybeSingle(),
    supabase.from('settings').select('birth_year').maybeSingle(),
    supabase.from('allocations').select('*').eq('section', 'growth'),
  ]);
  const er = (s.data as { expected_return?: number } | null)?.expected_return;
  const by = (birth.data as { birth_year?: number } | null)?.birth_year;
  return {
    settings: {
      expected_return: er != null ? Number(er) : DEFAULT_RETURN,
      birth_year: by != null ? Number(by) : null,
      canSave: !s.error,
    },
    growth: (growth.data as Allocation[]) ?? [],
  };
}

export async function saveForecast(expectedReturn: number, birthYear: number | null) {
  const res = await supabase.from('settings').update({ expected_return: expectedReturn, birth_year: birthYear }).not('user_id', 'is', null);
  if (res.error) throw new Error(res.error.message);
}

export interface Pace {
  monthly: number | null; // HKD a month into liquid accounts
  months: number; // how many months it is averaged over
}

/** Average Growth going into liquid accounts over the last 3 months that have Growth lines.
 *  Lines into locked (SRS, MPF) or illiquid accounts are left out, like the Freedom number. */
export function liquidPace(growth: Allocation[], buckets: Bucket[], tags: Tag[], fx: FxRate[], upTo = defaultBudgetMonth()): Pace {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const tagBucket = (id: string) => tags.find((t) => t.id === id)?.default_bucket_id ?? null;
  const perMonth = new Map<string, number>();
  for (const a of growth) {
    if (a.budget_month > upTo) continue;
    const dest = byId.get(a.to_bucket_id ?? tagBucket(a.tag_id) ?? '');
    const liquid = !dest || dest.liquidity === 'Liquid';
    const rates = ratesAt(fx, a.budget_month);
    const rate = a.currency === 'HKD' ? 1 : rates[a.currency];
    if (!rate) continue;
    perMonth.set(a.budget_month, (perMonth.get(a.budget_month) ?? 0) + (liquid ? Number(a.amount) * rate : 0));
  }
  const recent = [...perMonth.keys()].sort().slice(-3);
  if (!recent.length) return { monthly: null, months: 0 };
  return { monthly: recent.reduce((s, m) => s + perMonth.get(m)!, 0) / recent.length, months: recent.length };
}

/** Months until `start` reaches `goal`, adding `monthly` each month and growing at `yearly`. */
export function monthsTo(start: number, monthly: number, yearly: number, goal: number): number | null {
  if (start >= goal) return 0;
  const r = Math.pow(1 + yearly, 1 / 12) - 1;
  let v = start;
  for (let i = 1; i <= 1200; i++) {
    v = v * (1 + r) + monthly;
    if (v >= goal) return i;
  }
  return null; // more than 100 years: not at this pace
}

/** The month that is n months after this one, as 'YYYY-MM-01'. */
export function monthsFromNow(n: number, today = new Date()): string {
  return addMonths(monthKey(today.getFullYear(), today.getMonth()), n);
}
