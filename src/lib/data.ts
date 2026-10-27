import { supabase } from './supabase';
import type { Allocation, Bucket, FxRate, Income, Line, Statement, Tag } from './types';

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
}

export async function loadSetup(): Promise<{ tags: Tag[]; buckets: Bucket[] }> {
  const [tags, buckets] = await Promise.all([
    supabase.from('tags').select('*').order('kind').order('sort').order('name'),
    supabase.from('buckets').select('*').order('sort').order('name'),
  ]);
  return { tags: check(tags) ?? [], buckets: check(buckets) ?? [] };
}

export async function loadMonth(month: string): Promise<MonthData> {
  const [income, allocations, lines, statement, fx] = await Promise.all([
    supabase.from('income').select('*').eq('budget_month', month).order('received_on'),
    supabase.from('allocations').select('*').eq('budget_month', month).order('sort').order('created_at'),
    supabase.from('month_lines').select('section,line_id,amount_hkd,actual_hkd').eq('budget_month', month),
    supabase.from('month_statement').select('*').eq('budget_month', month).maybeSingle(),
    supabase.from('fx_rates').select('*').lte('month', month).order('month', { ascending: false }),
  ]);
  return {
    income: check(income) ?? [],
    allocations: check(allocations) ?? [],
    lines: check(lines) ?? [],
    statement: check(statement),
    fx: check(fx) ?? [],
  };
}

type Row = Record<string, unknown>;

export async function save(table: 'income' | 'allocations' | 'tags' | 'buckets', row: Row, id?: string) {
  const res = id
    ? await supabase.from(table).update(row).eq('id', id)
    : await supabase.from(table).insert(row);
  if (res.error) throw new Error(res.error.message);
}

export async function remove(table: 'income' | 'allocations', id: string) {
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
