import { supabase } from './supabase';
import { addMonths } from './format';
import { setCurrencies, type AccountGroup, type Allocation, type Bucket, type Expense, type FxRate, type Income, type Line, type Statement, type Tag } from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export interface MonthData {
  income: Income[];
  allocations: Allocation[];
  lines: Line[];
  statement: Statement | null;
  fx: FxRate[];
  /** Charges from the month before: the card bills this month pays. */
  bills: Expense[];
}

export async function loadSetup(): Promise<{ tags: Tag[]; buckets: Bucket[]; groups: AccountGroup[]; currencies: string[] }> {
  const [tags, buckets, groups, settings] = await Promise.all([
    supabase.from('tags').select('*').order('kind').order('sort').order('name'),
    supabase.from('buckets').select('*').order('sort').order('name'),
    supabase.from('account_groups').select('*').order('sort').order('name'),
    supabase.from('settings').select('*').maybeSingle(),
  ]);
  // Groups and the currency list arrive with migration 004; until then, fall back quietly.
  const s = settings.data as { currencies?: string[] } | null;
  if (s?.currencies?.length) setCurrencies(s.currencies);
  return {
    tags: check(tags) ?? [],
    buckets: check(buckets) ?? [],
    groups: groups.error ? [] : (groups.data as AccountGroup[]) ?? [],
    currencies: s?.currencies ?? [],
  };
}

export async function saveCurrencies(list: string[]) {
  const res = await supabase.from('settings').update({ currencies: list }).not('user_id', 'is', null);
  if (res.error) throw new Error(res.error.message);
}

export async function saveGroup(row: Row, id?: string) {
  const res = id ? await supabase.from('account_groups').update(row).eq('id', id) : await supabase.from('account_groups').insert(row);
  if (res.error) throw new Error(res.error.message);
}

export async function removeGroup(id: string) {
  const res = await supabase.from('account_groups').delete().eq('id', id);
  if (res.error) throw new Error(res.error.message);
}

export async function loadMonth(month: string): Promise<MonthData> {
  const [income, allocations, lines, statement, fx, bills] = await Promise.all([
    supabase.from('income').select('*').eq('budget_month', month).order('received_on'),
    supabase.from('allocations').select('*').eq('budget_month', month).order('sort').order('created_at'),
    supabase.from('month_lines').select('section,line_id,amount_hkd,actual_hkd').eq('budget_month', month),
    supabase.from('month_statement').select('*').eq('budget_month', month).maybeSingle(),
    supabase.from('fx_rates').select('*').lte('month', month).order('month', { ascending: false }),
    supabase.from('expenses').select('*').eq('statement_month', addMonths(month, -1)),
  ]);
  return {
    income: check(income) ?? [],
    allocations: check(allocations) ?? [],
    lines: check(lines) ?? [],
    statement: check(statement),
    fx: check(fx) ?? [],
    bills: check(bills) ?? [],
  };
}

type Row = Record<string, unknown>;

export async function save(table: 'income' | 'allocations' | 'tags' | 'buckets' | 'expenses', row: Row, id?: string) {
  const res = id
    ? await supabase.from(table).update(row).eq('id', id)
    : await supabase.from(table).insert(row);
  if (res.error) throw new Error(res.error.message);
}

export async function remove(table: 'income' | 'allocations' | 'expenses', id: string) {
  const res = await supabase.from(table).delete().eq('id', id);
  if (res.error) throw new Error(res.error.message);
}

export async function saveFx(month: string, currency: string, rate: number) {
  const res = await supabase.from('fx_rates').upsert({ month, currency, rate_to_hkd: rate }, { onConflict: 'user_id,month,currency' });
  if (res.error) throw new Error(res.error.message);
}

export async function copyPlan(from: string, to: string): Promise<number> {
  const res = await supabase.rpc('copy_plan', { from_month: from, to_month: to });
  if (res.error) throw new Error(res.error.message);
  return res.data as number;
}

/** Charges made in a calendar month, or landing on a statement that closes in it. */
export async function loadExpenses(month: string): Promise<{ expenses: Expense[]; fx: FxRate[] }> {
  const [expenses, fx] = await Promise.all([
    supabase.from('expenses').select('*').or(`budget_month.eq.${month},statement_month.eq.${month}`).order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('fx_rates').select('*').lte('month', month).order('month', { ascending: false }),
  ]);
  return { expenses: check(expenses) ?? [], fx: check(fx) ?? [] };
}

/** Mark every charge on one card's statement as settled (or back to charged). */
export async function settleStatement(bucketId: string, statementMonth: string, settled: boolean, on: string) {
  const q = supabase.from('expenses').update({ settled_on: settled ? on : null }).eq('paid_from', bucketId).eq('statement_month', statementMonth);
  const res = settled ? await q.is('settled_on', null) : await q;
  if (res.error) throw new Error(res.error.message);
}

/** Tick (or untick) the card's bill line in the plan that pays this statement. */
export async function tickBill(bucketId: string, statementMonth: string, done: boolean, on: string) {
  const res = await supabase.from('allocations').update({ done, done_on: done ? on : null })
    .eq('section', 'opex').eq('to_bucket_id', bucketId).eq('budget_month', addMonths(statementMonth, 1));
  if (res.error) throw new Error(res.error.message);
}

export async function insertBucket(row: Row): Promise<string> {
  const res = await supabase.from('buckets').insert(row).select('id').single();
  if (res.error) throw new Error(res.error.message);
  return (res.data as { id: string }).id;
}
