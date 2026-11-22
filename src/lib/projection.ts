// Where this month's everyday spending is heading, shown above "Spent" on the Expense screen.
// Everyday = everything you used this month except Plans (trips have their own budget) and work costs.
// Projection = spent so far + your day-to-day pace for the days left + regular bills not in yet.
import type { Expense } from './types';
import { BOOKS_START, addMonths } from './format';
import { spread, shareIn } from './spend';

export interface Projection {
  day: number; // today's day of the month
  daysLeft: number;
  soFar: number; // HKD, everyday spending used this month so far
  big: { e: Expense; v: number }[]; // bigger items, counted once
  bigTotal: number;
  overTime: { e: Expense; v: number }[]; // used over a stretch of days: this month's share
  overTimeTotal: number;
  daily: number; // HKD, the day-to-day part of soFar
  perDay: number;
  rest: number; // perDay × daysLeft
  regulars: { e: Expense; v: number }[]; // bills from the last two months not in yet
  regularTotal: number;
  regularsFrom: string | null; // first month regulars can be spotted, when not yet
  plans: number; // HKD of plan costs this month, left out
  total: number;
  early: boolean; // first week: the pace is still a guess
}

const isRefund = (e: Expense) => Number(e.amount) < 0;
const key = (e: Expense) => `${(e.vendor ?? '').trim().toLowerCase()}|${e.tag_id ?? ''}`;

/**
 * @param month        the month being projected ('2026-11-01'), the current month
 * @param today        ISO date, inside that month
 * @param used         expenses used this month (as the Expense screen loads them)
 * @param history      every expense (for regular bills); may be empty
 * @param bigFrom      HKD amount from which an item counts once instead of setting the pace
 */
export function project(month: string, today: string, used: Expense[], history: Expense[], hkdOf: (e: Expense) => number | null, bigFrom: number): Projection {
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(daysIn, Math.max(1, Number(today.slice(8, 10))));
  const daysLeft = daysIn - day;

  const counted = used.filter((e) => !e.reimbursable && !isRefund(e));
  const plans = counted.filter((e) => e.plan_id).reduce((s, e) => s + (hkdOf(e) ?? 0) * shareIn(e, month), 0);
  const everyday = counted.filter((e) => !e.plan_id);

  const big: Projection['big'] = [];
  const overTime: Projection['overTime'] = [];
  let daily = 0;
  for (const e of everyday) {
    const full = hkdOf(e) ?? 0;
    if (spread(e)) {
      const v = full * shareIn(e, month);
      if (v > 0) overTime.push({ e, v });
    } else if (e.budget_month === month) {
      if (full >= bigFrom) big.push({ e, v: full });
      else daily += full;
    }
  }
  big.sort((a, b) => b.v - a.v);
  overTime.sort((a, b) => b.v - a.v);
  const bigTotal = big.reduce((s, x) => s + x.v, 0);
  const overTimeTotal = overTime.reduce((s, x) => s + x.v, 0);
  const soFar = bigTotal + overTimeTotal + daily;
  const perDay = daily / day;
  const rest = perDay * daysLeft;

  // Regular bills: the same vendor and category exactly once in each of the last two full months,
  // not seen yet this month, and last month it came on a later day than today.
  const prev = addMonths(month, -1);
  const prev2 = addMonths(month, -2);
  const regulars: Projection['regulars'] = [];
  let regularsFrom: string | null = null;
  if (prev2 < BOOKS_START) {
    regularsFrom = addMonths(BOOKS_START, 2);
  } else {
    const plain = history.filter((e) => !e.reimbursable && !isRefund(e) && !e.plan_id && !spread(e) && (e.vendor ?? '').trim());
    const count = (mon: string) => {
      const c = new Map<string, Expense[]>();
      plain.filter((e) => e.budget_month === mon).forEach((e) => c.set(key(e), [...(c.get(key(e)) ?? []), e]));
      return c;
    };
    const last = count(prev);
    const before = count(prev2);
    const seen = new Set(everyday.map(key));
    for (const [k, rows] of last) {
      if (rows.length !== 1 || before.get(k)?.length !== 1 || seen.has(k)) continue;
      const e = rows[0];
      if (Number(e.spent_on.slice(8, 10)) <= day) continue;
      const v = hkdOf(e) ?? 0;
      if (v > 0) regulars.push({ e, v });
    }
    regulars.sort((a, b) => b.v - a.v);
  }
  const regularTotal = regulars.reduce((s, x) => s + x.v, 0);

  return {
    day, daysLeft, soFar, big, bigTotal, overTime, overTimeTotal, daily, perDay, rest,
    regulars, regularTotal, regularsFrom, plans,
    total: soFar + rest + regularTotal,
    early: day < 7,
  };
}
