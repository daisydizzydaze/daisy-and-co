// Reports: five health questions about Daisy & Co for a month, quarter or year.
// Nothing new is stored: everything comes from Allocation, Expenses and Net worth closes.
import { supabase } from './supabase';
import { bridge, kindOf, ratesAt, totalsByMonth, type Balance, type MonthTotals, type NetWorthData } from './networth';
import { makeHkdOf, shareIn, usedMonths } from './spend';
import { BOOKS_START, addMonths, monthKey, shortMonth, thisMonth, todayISO } from './format';
import type { Allocation, Bucket, Expense, FxRate, Income, Plan, Statement, Tag } from './types';

export interface ReportData {
  statements: Statement[];
  expenses: Expense[];
  income: Income[];
  allocations: Allocation[]; // done ones
  balances: Balance[]; // newest first
  fx: FxRate[]; // newest first
}

export async function loadReports(): Promise<ReportData> {
  const [statements, expenses, income, allocations, balances, fx] = await Promise.all([
    supabase.from('month_statement').select('*').order('budget_month'),
    supabase.from('expenses').select('*'),
    supabase.from('income').select('*'),
    supabase.from('allocations').select('*').eq('done', true),
    supabase.from('balances').select('*').order('month', { ascending: false }),
    supabase.from('fx_rates').select('*').order('month', { ascending: false }),
  ]);
  for (const r of [statements, expenses, income, allocations, fx]) if (r.error) throw new Error(r.error.message);
  const num = (v: unknown) => Number(v ?? 0);
  return {
    statements: ((statements.data as Statement[]) ?? []).map((s) => ({
      ...s, gross_income: num(s.gross_income), tax: num(s.tax), net_income: num(s.net_income), growth: num(s.growth),
    })),
    expenses: (expenses.data as Expense[]) ?? [],
    income: (income.data as Income[]) ?? [],
    allocations: (allocations.data as Allocation[]) ?? [],
    balances: ((balances.data as Balance[]) ?? []).map((b) => ({ ...b, value: num(b.value), money_in: num(b.money_in) })),
    fx: (fx.data as FxRate[]) ?? [],
  };
}

// ---------- periods ----------

export type PeriodKind = 'month' | 'quarter' | 'year';
export interface Period { kind: PeriodKind; start: string } // start = first month, 'YYYY-MM-01'

const LEN: Record<PeriodKind, number> = { month: 1, quarter: 3, year: 12 };
export const monthsOf = (p: Period) => Array.from({ length: LEN[p.kind] }, (_, i) => addMonths(p.start, i));
export const endOf = (p: Period) => addMonths(p.start, LEN[p.kind] - 1);
export const shift = (p: Period, n: number): Period => ({ kind: p.kind, start: addMonths(p.start, n * LEN[p.kind]) });

/** The period of a kind that contains a month. */
export function periodAt(kind: PeriodKind, month = thisMonth()): Period {
  const [y, m] = month.split('-').map(Number);
  if (kind === 'month') return { kind, start: month };
  if (kind === 'quarter') return { kind, start: monthKey(y, Math.floor((m - 1) / 3) * 3) };
  return { kind, start: monthKey(y, 0) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function periodLabel(p: Period): string {
  const [y, m] = p.start.split('-').map(Number);
  if (p.kind === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (p.kind === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  return String(y);
}
/** "October", "Q4", "2026": for sentences. */
export function periodShort(p: Period): string {
  const [, m] = p.start.split('-').map(Number);
  if (p.kind === 'month') return MONTHS[m - 1];
  if (p.kind === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1}`;
  return p.start.slice(0, 4);
}

/** Share of the period that has passed (1 once it's over). */
export function elapsed(p: Period, today = todayISO()): number {
  const t = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const start = t(p.start);
  const end = t(addMonths(endOf(p), 1));
  const now = t(today) + 86_400_000; // today counts
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

// ---------- the questions ----------

export type Status = 'good' | 'watch' | 'bad' | 'none';

export interface Line { label: string; hkd: number; change?: number | null; base?: number }

export interface Means {
  status: Status;
  gross: number; tax: number; takeHome: number;
  needs: number; wants: number; plans: number; spent: number;
  kept: number; rate: number | null; plannedRate: number | null;
  needCats: Line[]; wantCats: Line[]; planLines: Line[];
  payMonths: number; // how many months of pay are in
}

export interface Richer {
  status: Status;
  end: MonthTotals | null;
  prev: MonthTotals | null;
  change: number | null;
  saved: number | null; gains: number | null; currency: number | null;
  sections: { label: string; hkd: number; change: number | null; accounts: Line[] }[];
}

export interface Runway {
  status: Status;
  cash: number | null;
  monthly: number | null;
  months: number | null;
  avgOver: number;
  closeMonth: string | null;
}

export interface Creep {
  status: Status;
  now: number;
  usual: number | null; // scaled to the part of the period that has passed
  change: number | null; // ratio − 1
  basis: string; // e.g. "vs your 3-month average"
  partial: boolean; // the period is still running: compared with a whole usual period
  cats: Line[]; // per category: hkd = now, base = usual, change; biggest change first
}

export interface AddUp {
  status: Status;
  from: string | null; to: string | null; // close dates
  pay: number; other: number; direct: number; cards: number; invested: number; debts: number;
  logged: number | null;
  actual: number | null;
  gap: number | null;
}

export interface Report { means: Means; richer: Richer; runway: Runway; creep: Creep; addUp: AddUp; inProgress: boolean; partStart: boolean }

const isRefund = (e: Expense) => Number(e.amount) < 0;

export function buildReport(p: Period, d: ReportData, buckets: Bucket[], tags: Tag[], plans: Plan[], now = thisMonth()): Report {
  // Spending and pay count from the start of the books; closes (balance sheet, cash flow) count from the first close.
  const months = monthsOf(p).filter((m) => m >= BOOKS_START);
  const set = new Set(months);
  const hkdOf = makeHkdOf(d.fx);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const topOf = (id: string | null) => { const t = tagById.get(id ?? ''); return t?.parent_id && tagById.has(t.parent_id) ? t.parent_id : id ?? ''; };
  const catName = (id: string) => tagById.get(id)?.name ?? 'Uncategorised';
  const counted = d.expenses.filter((e) => !e.reimbursable && !isRefund(e));
  const usedIn = (e: Expense, ms: Set<string>) => usedMonths(e).filter((m) => ms.has(m)).reduce((s, m) => s + shareIn(e, m), 0);
  const inProgress = endOf(p) >= now;

  // ---- 1. Living within my means: take-home that funds the period vs what it used ----
  const stm = d.statements.filter((s) => set.has(s.budget_month) && s.gross_income > 0);
  const gross = stm.reduce((s, x) => s + x.gross_income, 0);
  const tax = stm.reduce((s, x) => s + x.tax, 0);
  const takeHome = stm.reduce((s, x) => s + x.net_income, 0);
  const growth = stm.reduce((s, x) => s + x.growth, 0);
  const byCat = { need: new Map<string, number>(), want: new Map<string, number>() };
  const byPlan = new Map<string, number>();
  for (const e of counted) {
    const share = usedIn(e, set);
    if (!share) continue;
    const v = (hkdOf(e) ?? 0) * share;
    if (e.plan_id) { byPlan.set(e.plan_id, (byPlan.get(e.plan_id) ?? 0) + v); continue; }
    const m = byCat[(e.need_want ?? 'need') as 'need' | 'want'];
    const k = topOf(e.tag_id);
    m.set(k, (m.get(k) ?? 0) + v);
  }
  const lines = (m: Map<string, number>, name: (id: string) => string) =>
    [...m.entries()].map(([k, v]) => ({ label: name(k), hkd: v })).sort((a, b) => b.hkd - a.hkd);
  const needCats = lines(byCat.need, catName);
  const wantCats = lines(byCat.want, catName);
  const planLines = lines(byPlan, (id) => plans.find((x) => x.id === id)?.name ?? 'Plan');
  const sum = (l: Line[]) => l.reduce((s, x) => s + x.hkd, 0);
  const needs = sum(needCats), wants = sum(wantCats), planCost = sum(planLines);
  const spent = needs + wants + planCost;
  const kept = takeHome - spent;
  const rate = takeHome > 0 ? kept / takeHome : null;
  const plannedRate = takeHome > 0 ? growth / takeHome : null;
  const means: Means = {
    status: rate === null ? 'none' : rate < 0 ? 'bad' : plannedRate !== null && rate + 1e-9 < plannedRate ? 'watch' : 'good',
    gross, tax, takeHome, needs, wants, plans: planCost, spent, kept, rate, plannedRate,
    needCats, wantCats, planLines, payMonths: stm.length,
  };

  // ---- 2. Getting richer: last close in the period vs the close before it ----
  const nw = { balances: d.balances, fx: d.fx } as NetWorthData;
  const closes = totalsByMonth(buckets, nw);
  const allMonths = new Set(monthsOf(p));
  const end = [...closes].reverse().find((c) => allMonths.has(c.month)) ?? null;
  const prev = [...closes].reverse().find((c) => c.month < p.start) ?? null;
  let gains: number | null = null, currency: number | null = null;
  if (end && prev) {
    gains = 0; currency = 0;
    const between = closes.filter((c) => c.month >= prev.month && c.month <= end.month);
    for (let i = 1; i < between.length; i++) {
      const b = bridge(buckets, nw, between[i - 1].month, between[i].month);
      gains += b.gains; currency += b.currency;
    }
  }
  const change = end && prev ? end.net - prev.net : null;
  const saved = change !== null ? change - (gains ?? 0) - (currency ?? 0) : null;
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const valueAt = (month: string | undefined, id: string) => {
    if (!month) return null;
    const row = d.balances.find((x) => x.month === month && x.bucket_id === id);
    const b = byId.get(id);
    if (!row || !b) return null;
    const r = ratesAt(d.fx, month);
    const rate = b.currency === 'HKD' ? 1 : r[b.currency];
    return rate ? row.value * rate : null;
  };
  const SECS = ['Liquid', 'Locked until age', 'Illiquid', 'Debts'];
  const secOf = (b: Bucket) => (['card', 'loan'].includes(kindOf(b)) ? 'Debts' : SECS.includes(b.liquidity) ? b.liquidity : 'Liquid');
  const sections = SECS.map((label) => {
    const accts = buckets.filter((b) => secOf(b) === label && valueAt(end?.month, b.id) !== null);
    const acctLines = accts.map((b) => {
      const v = valueAt(end?.month, b.id)!;
      const pv = valueAt(prev?.month, b.id);
      return { label: b.name, hkd: v, change: pv === null ? null : v - pv };
    }).sort((a, b) => b.hkd - a.hkd);
    const total = sum(acctLines);
    const prevTotal = prev ? accts.reduce((s, b) => s + (valueAt(prev.month, b.id) ?? 0), 0) : null;
    return { label, hkd: total, change: prevTotal === null ? null : total - prevTotal, accounts: acctLines };
  }).filter((s) => s.accounts.length);
  const richer: Richer = {
    status: change === null ? 'none' : change > 0 ? 'good' : (saved ?? 0) > 0 ? 'watch' : 'bad',
    end, prev, change, saved, gains, currency, sections,
  };

  // ---- 3. Ride out a bad month: cash & bank at the close ÷ usual monthly spending ----
  const fullBefore = (m: string) => m >= BOOKS_START && m < now;
  const everydayIn = (m: string) => counted.filter((e) => !e.plan_id).reduce((s, e) => s + (hkdOf(e) ?? 0) * shareIn(e, m), 0);
  const avgMonths: string[] = [];
  for (let m = endOf(p) < now ? endOf(p) : addMonths(now, -1); fullBefore(m) && avgMonths.length < 3; m = addMonths(m, -1)) avgMonths.push(m);
  const monthly = avgMonths.length ? avgMonths.reduce((s, m) => s + everydayIn(m), 0) / avgMonths.length : null;
  const cashIds = buckets.filter((b) => kindOf(b) === 'cash').map((b) => b.id);
  const cash = end ? cashIds.reduce((s, id) => s + (valueAt(end.month, id) ?? 0), 0) : null;
  const runMonths = cash !== null && monthly ? cash / monthly : null;
  const runway: Runway = {
    status: runMonths === null ? 'none' : runMonths >= 6 ? 'good' : runMonths >= 3 ? 'watch' : 'bad',
    cash, monthly, months: runMonths, avgOver: avgMonths.length, closeMonth: end?.month ?? null,
  };

  // ---- 4. Spending creeping up: everyday spending vs usual, at the same point in the period ----
  const everyday = counted.filter((e) => !e.plan_id);
  const catTotals = (ms: Set<string>) => {
    const m = new Map<string, number>();
    for (const e of everyday) { const s = usedIn(e, ms); if (s) m.set(topOf(e.tag_id), (m.get(topOf(e.tag_id)) ?? 0) + (hkdOf(e) ?? 0) * s); }
    return m;
  };
  const nowCats = catTotals(set);
  const nowTotal = [...nowCats.values()].reduce((a, b) => a + b, 0);
  // Earlier periods to compare with: the 3 months before (Month), or the period before (Quarter, Year).
  const baseCount = p.kind === 'month' ? 3 : 1;
  const bases: Set<string>[] = [];
  for (let i = 1; bases.length < baseCount && i <= baseCount; i++) {
    const ms = monthsOf(shift(p, -i));
    if (ms.every(fullBefore)) bases.push(new Set(ms));
  }
  let usual: number | null = null;
  let cats: Line[] = [];
  if (bases.length) {
    const baseCats = new Map<string, number>();
    for (const b of bases) for (const [k, v] of catTotals(b)) baseCats.set(k, (baseCats.get(k) ?? 0) + v / bases.length);
    const scale = 1; // a part period is compared with a whole usual one: lumpy bills like rent make pro-rating misleading
    usual = [...baseCats.values()].reduce((a, b) => a + b, 0) * scale;
    const keys = new Set([...nowCats.keys(), ...baseCats.keys()]);
    cats = [...keys].map((k) => ({ label: catName(k), hkd: nowCats.get(k) ?? 0, base: (baseCats.get(k) ?? 0) * scale, change: (nowCats.get(k) ?? 0) - (baseCats.get(k) ?? 0) * scale }))
      .filter((l) => Math.abs(l.change!) >= 1)
      .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
  }
  const creepChange = usual ? nowTotal / usual - 1 : null;
  const basis = !bases.length ? ''
    : p.kind === 'month' ? `vs your ${bases.length === 1 ? 'last full month' : `${bases.length}-month average`}`
    : `vs last ${p.kind}`;
  // Still running: only a warning once it's past the usual whole period.
  const creep: Creep = {
    status: creepChange === null ? 'none' : creepChange <= 0.0001 ? 'good' : creepChange <= 0.1 ? 'watch' : 'bad',
    now: nowTotal, usual, change: creepChange, basis, cats, partial: inProgress,
  };

  // ---- 5. Does every dollar add up: logged money in and out of cash & bank between two closes ----
  let addUp: AddUp = { status: 'none', from: null, to: null, pay: 0, other: 0, direct: 0, cards: 0, invested: 0, debts: 0, logged: null, actual: null, gap: null };
  if (end && prev) {
    const from = prev.closedOn, to = end.closedOn;
    const r = ratesAt(d.fx, end.month);
    const hk = (amt: number, cur: string) => (cur === 'HKD' ? amt : r[cur] ? amt * r[cur] : 0);
    const inWin = (iso: string | null) => !!iso && iso > from && iso <= to;
    const isCash = (id: string | null) => !!id && cashIds.includes(id);
    const tagBucket = (id: string) => tagById.get(id)?.default_bucket_id ?? null;
    const landing = (month: string) => d.income.find((i) => i.budget_month === month && i.bucket_id)?.bucket_id ?? null;
    let pay = 0, direct = 0, cards = 0, invested = 0, debts = 0, other = 0;
    for (const i of d.income) if (isCash(i.bucket_id) && inWin(i.received_on)) pay += hk(Number(i.gross_amount) - Number(i.tax_withheld), i.currency);
    for (const e of d.expenses) if (isCash(e.paid_from) && inWin(e.spent_on)) direct += hk(Number(e.charged_amount ?? e.amount), e.charged_amount != null ? e.charged_currency ?? e.currency : e.currency);
    for (const a of d.allocations) {
      if (!inWin(a.done_on)) continue;
      const src = a.from_bucket_id ?? landing(a.budget_month);
      const dst = a.to_bucket_id ?? tagBucket(a.tag_id);
      const amt = hk(Number(a.amount), a.currency);
      if (isCash(src) && !isCash(dst)) {
        const k = dst ? kindOf(byId.get(dst) ?? ({ type: 'Other' } as Bucket)) : null;
        if (k === 'card' || (!dst && a.section === 'opex')) cards += amt;
        else if (k === 'loan') debts += amt;
        else if (dst || a.section === 'growth') invested += amt;
      } else if (!isCash(src) && isCash(dst)) other += amt;
    }
    const actual = cashIds.reduce((s, id) => {
      const b = byId.get(id)!;
      const e1 = d.balances.find((x) => x.month === end.month && x.bucket_id === id);
      const e0 = d.balances.find((x) => x.month === prev.month && x.bucket_id === id);
      return e1 && e0 ? s + hk(e1.value - e0.value, b.currency) : s;
    }, 0);
    const logged = pay + other - direct - cards - invested - debts;
    const gap = actual - logged;
    const tolerance = Math.max(1000, Math.abs(cash ?? 0) * 0.02);
    addUp = {
      status: Math.abs(gap) <= tolerance ? 'good' : 'watch',
      from, to, logged, actual, gap, pay, other, direct, cards, invested, debts,
    };
  }

  return { means, richer, runway, creep, addUp, inProgress, partStart: p.start < BOOKS_START };
}

export const dayMonth = (iso: string) => `${Number(iso.slice(8))} ${shortMonth(iso.slice(0, 7) + '-01')}`;
