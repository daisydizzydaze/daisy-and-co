// Net Worth: the balance sheet. Values are saved once a month ("close the month");
// between closes the app estimates them from what you log on the other screens.
import { supabase } from './supabase';
import { inCardCurrency, ratesFrom } from './fx';
import { loanStatus } from './loan';
import { addMonths, thisMonth, todayISO } from './format';
import type { Allocation, Bucket, Expense, FxRate, Income, Tag } from './types';

export interface Balance {
  month: string;
  closed_on: string;
  bucket_id: string;
  value: number;
  money_in: number;
  source: string;
  note: string | null;
}

export interface FireSettings {
  fire_monthly_spend: number;
  withdrawal_rate: number;
}

export interface NetWorthData {
  balances: Balance[]; // newest month first
  fx: FxRate[]; // newest month first
  settings: FireSettings;
  /** Logged since the earliest close the screen needs (or everything, before the first close). */
  income: Income[];
  allocations: Allocation[]; // done ones only
  expenses: Expense[]; // spent since then, plus every charge not yet settled
  missingTable: boolean; // migration 009 not run yet
}

/** Which month a close made today belongs to. Like pay, from the 20th it is this month's;
 *  before the 20th it is a late close for last month (8 Nov counts as October). */
export function closeMonth(today = new Date()): string {
  return today.getDate() >= 20 ? thisMonth(today) : addMonths(thisMonth(today), -1);
}

export type Kind = 'card' | 'loan' | 'cash' | 'invest' | 'property';

export function kindOf(b: Bucket): Kind {
  if (b.type === 'Card') return 'card';
  if (b.type === 'Loan' || b.is_liability) return 'loan';
  if (b.type === 'Bank' || b.type === 'Cash') return 'cash';
  if (b.type === 'Property') return 'property';
  return 'invest';
}
export const isDebt = (b: Bucket) => ['card', 'loan'].includes(kindOf(b));
/** Accounts whose change splits into money put in and gain. */
export const hasGain = (b: Bucket) => ['invest', 'property'].includes(kindOf(b));

export async function loadNetWorth(): Promise<NetWorthData> {
  const [balances, fx, settings] = await Promise.all([
    supabase.from('balances').select('*').order('month', { ascending: false }),
    supabase.from('fx_rates').select('*').order('month', { ascending: false }),
    supabase.from('settings').select('fire_monthly_spend,withdrawal_rate').maybeSingle(),
  ]);
  const missingTable = !!balances.error;
  const rows = ((balances.data as Balance[]) ?? []).map((b) => ({ ...b, value: Number(b.value), money_in: Number(b.money_in) }));
  // Flows are needed from the close before this month's (a close can be redone in the same month).
  const now = closeMonth();
  const base = rows.find((r) => r.month < now) ?? rows[rows.length - 1];
  const since = base?.closed_on ?? '1900-01-01';
  const [income, allocations, spent, unsettled] = await Promise.all([
    supabase.from('income').select('*').gt('received_on', since),
    supabase.from('allocations').select('*').eq('done', true).gt('done_on', since),
    supabase.from('expenses').select('*').gt('spent_on', since),
    supabase.from('expenses').select('*').is('settled_on', null),
  ]);
  const seen = new Set<string>();
  const expenses = [...((spent.data as Expense[]) ?? []), ...((unsettled.data as Expense[]) ?? [])].filter((e) => !seen.has(e.id) && seen.add(e.id));
  const s = settings.data as FireSettings | null;
  return {
    balances: rows,
    fx: (fx.data as FxRate[]) ?? [],
    settings: { fire_monthly_spend: Number(s?.fire_monthly_spend ?? 40000), withdrawal_rate: Number(s?.withdrawal_rate ?? 0.035) },
    income: (income.data as Income[]) ?? [],
    allocations: (allocations.data as Allocation[]) ?? [],
    expenses,
    missingTable,
  };
}

export async function saveClose(rows: Balance[], putInBefore: Record<string, number | null>) {
  if (rows.length) {
    const res = await supabase.from('balances').upsert(rows, { onConflict: 'user_id,month,bucket_id' });
    if (res.error) throw new Error(res.error.message);
  }
  for (const [id, v] of Object.entries(putInBefore)) {
    const res = await supabase.from('buckets').update({ put_in_before: v }).eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }
}

export async function saveFire(s: FireSettings) {
  const res = await supabase.from('settings').update(s).not('user_id', 'is', null);
  if (res.error) throw new Error(res.error.message);
}

export const fireTarget = (s: FireSettings) => (s.withdrawal_rate > 0 ? (s.fire_monthly_spend * 12) / s.withdrawal_rate : null);

/** Rates for a month: that month's, or the latest earlier one. */
export const ratesAt = (fx: FxRate[], month: string) => ratesFrom(fx.filter((f) => f.month <= month));

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (from === to) return amount;
  const a = rates[from], b = rates[to];
  return a && b ? (amount * a) / b : null;
}

/** What the app can work out by itself today, in the account's currency. */
export function computedValue(b: Bucket, d: NetWorthData, rates: Record<string, number>): { value: number; source: string } | null {
  switch (kindOf(b)) {
    case 'card': {
      let owed = 0;
      for (const e of d.expenses) {
        if (e.paid_from !== b.id || e.settled_on) continue;
        owed += inCardCurrency(e, b.currency, rates) ?? 0;
      }
      return { value: owed, source: 'cards' };
    }
    case 'loan': {
      const st = loanStatus(b, todayISO());
      return st?.balance != null ? { value: st.balance, source: 'loan' } : null;
    }
    default:
      if (b.type === 'Equity' && b.shares != null && b.price_per_share != null) return { value: Number(b.shares) * Number(b.price_per_share), source: 'shares' };
      if (b.type === 'Insurance' && b.surrender_value != null) return { value: Number(b.surrender_value), source: 'surrender' };
      return null;
  }
}

/** Money moved in and out of an account since a date, from Allocation and Expense, in its own currency. */
export function flowsSince(b: Bucket, since: string, d: NetWorthData, tags: Tag[], rates: Record<string, number>) {
  let moneyIn = 0; // from Allocation: income landing here, lines moving money in or out
  let spent = 0; // from Expense: paid straight from this account
  const tagBucket = (id: string) => tags.find((t) => t.id === id)?.default_bucket_id ?? null;
  // A line with no "from" account is paid from wherever that month's pay landed.
  const landing = (month: string) => d.income.find((i) => i.budget_month === month && i.bucket_id)?.bucket_id ?? null;
  for (const i of d.income) {
    if (i.bucket_id !== b.id || i.received_on <= since) continue;
    moneyIn += convert(Number(i.gross_amount) - Number(i.tax_withheld), i.currency, b.currency, rates) ?? 0;
  }
  for (const a of d.allocations) {
    if (!a.done_on || a.done_on <= since) continue;
    const amt = convert(Number(a.amount), a.currency, b.currency, rates) ?? 0;
    if ((a.to_bucket_id ?? tagBucket(a.tag_id)) === b.id) moneyIn += amt;
    if ((a.from_bucket_id ?? landing(a.budget_month)) === b.id) moneyIn -= amt;
  }
  if (kindOf(b) === 'cash') {
    for (const e of d.expenses) {
      if (e.paid_from !== b.id || e.spent_on <= since) continue;
      spent += inCardCurrency(e, b.currency, rates) ?? 0;
    }
  }
  return { moneyIn, spent };
}

export interface AccountView {
  b: Bucket;
  value: number | null; // today, in its own currency (debts: what you owe)
  estimated: boolean; // not typed today: last close + what's logged since
  moved: boolean; // something was logged since the last close
  last: Balance | null;
  putIn: number | null; // investments: everything put in so far
}

/** Each account today: worked out, or last close + what you've logged since. */
export function accountsToday(buckets: Bucket[], d: NetWorthData, tags: Tag[], rates: Record<string, number>): AccountView[] {
  return buckets.filter((b) => b.active).map((b) => {
    const mine = d.balances.filter((x) => x.bucket_id === b.id);
    const last = mine[0] ?? null;
    const comp = computedValue(b, d, rates);
    const f = last ? flowsSince(b, last.closed_on, d, tags, rates) : { moneyIn: 0, spent: 0 };
    let value: number | null = comp?.value ?? null;
    if (value === null && last) value = last.value + (kindOf(b) === 'property' ? 0 : f.moneyIn - f.spent);
    const putIn = hasGain(b) && b.put_in_before != null
      ? Number(b.put_in_before) + mine.reduce((s, x) => s + x.money_in, 0) + (last ? f.moneyIn : 0)
      : null;
    return { b, value, estimated: !comp, moved: Math.abs(f.moneyIn) + Math.abs(f.spent) > 0.005, last, putIn };
  });
}

/** One close: the totals for a month, in HKD. */
export interface MonthTotals {
  month: string;
  closedOn: string;
  assets: number;
  debts: number;
  net: number;
  liquid: number; // liquid assets less card balances: what counts toward FIRE
  bySection: Record<string, number>; // assets by Liquid / Locked until age / Illiquid
}

export function totalsByMonth(buckets: Bucket[], d: NetWorthData): MonthTotals[] {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const months = [...new Set(d.balances.map((x) => x.month))].sort();
  return months.map((m) => {
    const rates = ratesAt(d.fx, m);
    const t: MonthTotals = { month: m, closedOn: '', assets: 0, debts: 0, net: 0, liquid: 0, bySection: { Liquid: 0, 'Locked until age': 0, Illiquid: 0 } };
    for (const x of d.balances.filter((r) => r.month === m)) {
      const b = byId.get(x.bucket_id);
      if (!b) continue;
      t.closedOn = t.closedOn > x.closed_on ? t.closedOn : x.closed_on;
      const hkd = convert(x.value, b.currency, 'HKD', rates) ?? 0;
      if (isDebt(b)) t.debts += hkd; else t.assets += hkd;
      if (!isDebt(b)) { const sec = b.liquidity in t.bySection ? b.liquidity : 'Liquid'; t.bySection[sec] += hkd; }
      if (kindOf(b) === 'card') t.liquid -= hkd;
      else if (!isDebt(b) && b.liquidity === 'Liquid') t.liquid += hkd;
    }
    t.net = t.assets - t.debts;
    return t;
  });
}

/** What moved net worth between two closes: gains, currency, and the rest (saved less spent). */
export function bridge(buckets: Bucket[], d: NetWorthData, from: string, to: string) {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const r0 = ratesAt(d.fx, from), r1 = ratesAt(d.fx, to);
  let gains = 0, currency = 0;
  const prev = new Map(d.balances.filter((x) => x.month === from).map((x) => [x.bucket_id, x]));
  for (const x of d.balances.filter((r) => r.month === to)) {
    const b = byId.get(x.bucket_id);
    const p = prev.get(x.bucket_id);
    if (!b || !p) continue;
    const sign = isDebt(b) ? -1 : 1;
    const a0 = b.currency === 'HKD' ? 1 : r0[b.currency], a1 = b.currency === 'HKD' ? 1 : r1[b.currency];
    if (!a0 || !a1) continue;
    currency += sign * p.value * (a1 - a0);
    if (hasGain(b)) gains += (x.value - p.value - x.money_in) * a1;
  }
  return { gains, currency };
}
