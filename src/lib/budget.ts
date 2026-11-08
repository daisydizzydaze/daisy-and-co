// Budget: the yearly plan, run like a company's annual budget.
// Take-home pay − living costs − pay yourself first (Growth) = room for plans.
// The year's Plans (trips, big buys) then take their share of that room.
import { supabase } from './supabase';
import { ratesFrom, toHkd } from './fx';
import { bridge, ratesAt, totalsByMonth, type Balance, type NetWorthData } from './networth';
import { makeHkdOf } from './spend';
import { addMonths, monthKey, thisMonth } from './format';
import type { Bucket, Expense, FxRate, Plan, Statement } from './types';

export interface YearBudget {
  year: number;
  currency: string;
  take_home: number | null;
  bonus: number | null;
  living_monthly: number | null;
  growth_monthly: number | null;
  tally_take_home: number | null;
  tally_nw_start: number | null;
  tally_gains: number | null;
  tally_one_offs: number | null;
}

export interface BudgetData {
  statements: Statement[];
  expenses: Expense[];
  balances: Balance[];
  fx: FxRate[]; // newest first
  years: YearBudget[];
  missingTable: boolean; // migration 010 not run yet
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export async function loadBudget(): Promise<BudgetData> {
  const [statements, expenses, balances, fx, years] = await Promise.all([
    supabase.from('month_statement').select('*').order('budget_month'),
    supabase.from('expenses').select('*'),
    supabase.from('balances').select('*').order('month', { ascending: false }),
    supabase.from('fx_rates').select('*').order('month', { ascending: false }),
    supabase.from('year_budgets').select('*'),
  ]);
  if (statements.error) throw new Error(statements.error.message);
  if (expenses.error) throw new Error(expenses.error.message);
  return {
    statements: ((statements.data as Statement[]) ?? []).map((s) => ({ ...s, net_income: Number(s.net_income), gross_income: Number(s.gross_income), growth: Number(s.growth) })),
    expenses: (expenses.data as Expense[]) ?? [],
    balances: ((balances.data as Balance[]) ?? []).map((b) => ({ ...b, value: Number(b.value), money_in: Number(b.money_in) })),
    fx: (fx.data as FxRate[]) ?? [],
    years: ((years.data as Record<string, unknown>[]) ?? []).map((r) => ({
      year: Number(r.year),
      currency: String(r.currency ?? 'SGD'),
      take_home: n(r.take_home), bonus: n(r.bonus), living_monthly: n(r.living_monthly), growth_monthly: n(r.growth_monthly),
      tally_take_home: n(r.tally_take_home), tally_nw_start: n(r.tally_nw_start), tally_gains: n(r.tally_gains), tally_one_offs: n(r.tally_one_offs),
    })),
    missingTable: !!years.error,
  };
}

export async function saveYear(row: YearBudget) {
  const res = await supabase.from('year_budgets').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id,year' });
  if (res.error) throw new Error(res.error.message);
}

export const emptyYear = (year: number, currency = 'SGD'): YearBudget => ({
  year, currency, take_home: null, bonus: null, living_monthly: null, growth_monthly: null,
  tally_take_home: null, tally_nw_start: null, tally_gains: null, tally_one_offs: null,
});

/** From October the year being planned is next year; before that, this one. */
export function defaultYear(today = new Date()): number {
  return today.getFullYear() + (today.getMonth() >= 9 ? 1 : 0);
}

const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => monthKey(year, i));

export interface Source { label: string; note: string }

export interface PlanLine {
  plan: Plan;
  paid: number; // HKD, paid so far
  estimate: number | null; // HKD
  counts: number; // HKD: the larger of the two
  months: number[]; // 0-11, the months of the year it lands in
}

export interface Tally {
  year: number;
  takeHome: number | null;
  takeHomeFromApp: boolean;
  nwStart: number | null;
  nwStartFromApp: boolean;
  nwEnd: number | null; // the December close
  gains: number | null;
  appGains: number | null; // gains + currency the app saw between closes that year
  oneOffs: number;
  spent: number | null; // everything that year, trips included
  living: number | null; // per month, one-offs taken out
}

export interface YearView {
  year: number;
  takeHome: number | null; // HKD for the year, bonus included
  takeHomeNote: string;
  bonus: number;
  living: number | null; // HKD for the year
  livingNote: string;
  livingSource: 'typed' | 'tally' | 'logged' | 'none';
  loggedMonthly: number | null; // average of logged months, for comparison
  loggedMonths: number;
  growth: number | null; // HKD for the year
  growthNote: string;
  room: number | null;
  plans: PlanLine[];
  plansTotal: number;
  unpriced: number;
  free: number | null;
  tally: Tally;
}

/** HKD of a typed amount in the row's currency, at the latest rates. */
function typed(v: number | null, cur: string, rates: Record<string, number>): number | null {
  return v === null ? null : toHkd(v, cur, rates);
}

const isRefund = (e: Expense) => Number(e.amount) < 0;

/** Average spend per month over up to the last 12 full months logged, plan costs left out. */
export function loggedAverage(expenses: Expense[], fx: FxRate[], now = thisMonth()): { monthly: number | null; months: number } {
  const hkdOf = makeHkdOf(fx);
  const everyday = expenses.filter((e) => !e.plan_id && !e.reimbursable && !isRefund(e));
  if (!everyday.length) return { monthly: null, months: 0 };
  // The first month is usually only partly logged, so full months start the month after.
  const first = everyday.reduce((m, e) => (e.budget_month < m ? e.budget_month : m), everyday[0].budget_month);
  const months: string[] = [];
  for (let m = addMonths(now, -1); m > first && months.length < 12; m = addMonths(m, -1)) months.push(m);
  if (!months.length) return { monthly: null, months: 0 };
  const set = new Set(months);
  const total = everyday.filter((e) => set.has(e.budget_month)).reduce((s, e) => s + (hkdOf(e) ?? 0), 0);
  return { monthly: total / months.length, months: months.length };
}

function tallyFor(year: number, row: YearBudget | undefined, d: BudgetData, buckets: Bucket[], rates: Record<string, number>): Tally {
  const cur = row?.currency ?? 'SGD';
  const nw: NetWorthData = { balances: d.balances, fx: d.fx } as NetWorthData;
  const closes = totalsByMonth(buckets, nw);
  const dec = closes.find((c) => c.month === monthKey(year, 11));
  const prevDec = closes.find((c) => c.month === monthKey(year - 1, 11));
  // Take-home from the app only when every month of the year is in.
  const stm = monthsOf(year).map((m) => d.statements.find((s) => s.budget_month === m && s.gross_income > 0));
  const appTakeHome = stm.every(Boolean) ? stm.reduce((s, x) => s + (x?.net_income ?? 0), 0) : null;
  const typedTakeHome = typed(row?.tally_take_home ?? null, cur, rates);
  const takeHome = typedTakeHome ?? appTakeHome;
  const typedStart = typed(row?.tally_nw_start ?? null, cur, rates);
  const nwStart = typedStart ?? prevDec?.net ?? null;
  // Gains the app saw: between each pair of closes inside the year (and from last December).
  const inYear = closes.filter((c) => c.month >= monthKey(year - 1, 11) && c.month <= monthKey(year, 11));
  let appGains: number | null = null;
  for (let i = 1; i < inYear.length; i++) {
    const b = bridge(buckets, nw, inYear[i - 1].month, inYear[i].month);
    appGains = (appGains ?? 0) + b.gains + b.currency;
  }
  const gains = typed(row?.tally_gains ?? null, cur, rates) ?? appGains;
  const oneOffs = typed(row?.tally_one_offs ?? null, cur, rates) ?? 0;
  const nwEnd = dec?.net ?? null;
  const spent = takeHome !== null && nwStart !== null && nwEnd !== null ? takeHome - (nwEnd - nwStart - (gains ?? 0)) : null;
  return {
    year, takeHome, takeHomeFromApp: typedTakeHome === null && appTakeHome !== null,
    nwStart, nwStartFromApp: typedStart === null && !!prevDec, nwEnd, gains, appGains, oneOffs,
    spent, living: spent === null ? null : Math.max(0, spent - oneOffs) / 12,
  };
}

export function yearView(year: number, d: BudgetData, plans: Plan[], buckets: Bucket[], planningYear: number, now = thisMonth()): YearView {
  const rates = { ...ratesFrom(d.fx) };
  const row = d.years.find((y) => y.year === year);
  const cur = row?.currency ?? 'SGD';
  const months = monthsOf(year);
  const byMonth = new Map(d.statements.map((s) => [s.budget_month, s]));
  const paid = d.statements.filter((s) => s.gross_income > 0 && s.budget_month <= addMonths(now, 1));
  const recent = paid.slice(-3);

  // Take-home: months already paid count as they were; the rest at the last 3 pays' average.
  const avgNet = recent.length ? recent.reduce((s, x) => s + x.net_income, 0) / recent.length : null;
  const actualMonths = months.filter((m) => (byMonth.get(m)?.gross_income ?? 0) > 0);
  const bonus = typed(row?.bonus ?? null, cur, rates) ?? 0;
  let takeHome: number | null;
  let takeHomeNote: string;
  if (row?.take_home != null) {
    takeHome = (typed(row.take_home, cur, rates) ?? 0) + bonus;
    takeHomeNote = 'Your own number';
  } else if (avgNet === null && !actualMonths.length) {
    takeHome = null;
    takeHomeNote = 'Shows once your pay is on the Allocation screen';
  } else {
    takeHome = months.reduce((s, m) => s + (actualMonths.includes(m) ? byMonth.get(m)!.net_income : avgNet ?? 0), 0) + bonus;
    const projected = 12 - actualMonths.length;
    takeHomeNote = actualMonths.length === 0
      ? `12 months at your last ${recent.length === 1 ? 'pay' : `${recent.length} pays’ average`}`
      : projected === 0 ? 'From your Allocation screen' : `${actualMonths.length} months paid, ${projected} at your recent average`;
  }

  // Pay yourself first: Growth lines, same way.
  const avgGrowth = recent.length ? recent.reduce((s, x) => s + x.growth, 0) / recent.length : null;
  let growth: number | null;
  let growthNote: string;
  if (row?.growth_monthly != null) {
    growth = (typed(row.growth_monthly, cur, rates) ?? 0) * 12;
    growthNote = 'Your own number';
  } else if (avgGrowth === null && !actualMonths.length) {
    growth = null;
    growthNote = 'Shows once you have Growth lines on the Allocation screen';
  } else {
    growth = months.reduce((s, m) => s + (actualMonths.includes(m) ? byMonth.get(m)!.growth : avgGrowth ?? 0), 0);
    growthNote = 'Your Growth lines on the Allocation screen';
  }

  // Living costs: your own number, else last year's tally, else the logged average (3+ full months).
  const tally = tallyFor(year - 1, d.years.find((y) => y.year === year - 1), d, buckets, rates);
  const logged = loggedAverage(d.expenses, d.fx, now);
  let living: number | null = null;
  let livingNote = '';
  let livingSource: YearView['livingSource'] = 'none';
  if (row?.living_monthly != null) {
    living = (typed(row.living_monthly, cur, rates) ?? 0) * 12;
    livingSource = 'typed';
    livingNote = 'Your own number';
  } else if (tally.living !== null) {
    living = tally.living * 12;
    livingSource = 'tally';
    livingNote = `From your ${year - 1} tally`;
  } else if (logged.monthly !== null && logged.months >= 3) {
    living = logged.monthly * 12;
    livingSource = 'logged';
    livingNote = `Average of your last ${logged.months} logged months, plan costs left out`;
  } else {
    livingNote = `Waiting for your ${year - 1} tally`;
  }

  // The year's plans: dated in the year, or undated and still open (shown in the year being planned).
  const hkdOf = makeHkdOf(d.fx);
  const planPaid = new Map<string, number>();
  d.expenses.filter((e) => e.plan_id && !e.reimbursable).forEach((e) => planPaid.set(e.plan_id!, (planPaid.get(e.plan_id!) ?? 0) + (hkdOf(e) ?? 0)));
  const y = String(year);
  const lines: PlanLine[] = plans
    .filter((p) => (p.starts_on || p.ends_on)
      ? (p.starts_on ?? p.ends_on!).slice(0, 4) <= y && (p.ends_on ?? p.starts_on!).slice(0, 4) >= y
      : !p.done && year === planningYear)
    .map((p) => {
      const est = p.budget != null ? toHkd(Number(p.budget), p.budget_currency ?? 'HKD', rates) : null;
      const pd = planPaid.get(p.id) ?? 0;
      const from = p.starts_on ?? p.ends_on, to = p.ends_on ?? p.starts_on;
      const ms: number[] = [];
      if (from && to) months.forEach((m, i) => { if (m.slice(0, 7) >= from.slice(0, 7) && m.slice(0, 7) <= to.slice(0, 7)) ms.push(i); });
      return { plan: p, paid: pd, estimate: est, counts: Math.max(est ?? 0, pd), months: ms };
    })
    .sort((a, b) => (a.plan.starts_on ?? '9999').localeCompare(b.plan.starts_on ?? '9999') || a.plan.name.localeCompare(b.plan.name));
  const plansTotal = lines.reduce((s, l) => s + l.counts, 0);
  const room = takeHome !== null && living !== null && growth !== null ? takeHome - living - growth : null;

  return {
    year, takeHome, takeHomeNote, bonus, living, livingNote, livingSource,
    loggedMonthly: logged.monthly, loggedMonths: logged.months,
    growth, growthNote, room, plans: lines, plansTotal,
    unpriced: lines.filter((l) => l.estimate === null).length,
    free: room === null ? null : room - plansTotal,
    tally,
  };
}

export { ratesAt };
