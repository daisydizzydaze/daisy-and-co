import type { Allocation, Bucket } from './types';

const MONTHS_PER = { monthly: 1, quarterly: 3, yearly: 12 } as const;
const PER_YEAR = { monthly: 12, quarterly: 4, yearly: 1 } as const;

const parse = (d: string) => d.split('-').map(Number) as [number, number, number];
const iso = (y: number, m: number, d: number) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based here
  const t = new Date(Date.UTC(y, m - 1, Math.min(d, last)));
  return t.toISOString().slice(0, 10);
};
const addMonthsISO = (d: string, n: number) => {
  const [y, m, day] = parse(d);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, day);
};

/** Whole months from a to b, like Postgres age(). */
function monthsBetween(a: string, b: string) {
  const [y1, m1, d1] = parse(a);
  const [y2, m2, d2] = parse(b);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

export interface LoanStatus {
  made: number;
  left: number;
  lastPaymentOn: string;
  balance: number | null;
  exact: boolean;
  ahead: number; // repayments ticked as paid before their due date
}

/** The schedule date of the repayment a bill line in this plan month pays: the first on or after the 1st. */
function dueFor(b: Bucket, budgetMonth: string): string | null {
  const per = MONTHS_PER[b.payment_cadence ?? 'monthly'];
  for (let k = 0; k < (b.term_payments ?? 0); k++) {
    const d = addMonthsISO(b.first_payment_on!, k * per);
    if (d >= budgetMonth) return d;
  }
  return null;
}

/** Mirrors the loan_status view in the database. Repayments count on their due date, or earlier
 *  once their bill line is ticked as paid on Allocation (pass the done lines that pay this loan). */
export function loanStatus(b: Bucket, today: string, paid: Allocation[] = []): LoanStatus | null {
  if (!b.term_payments || !b.first_payment_on) return null;
  const per = MONTHS_PER[b.payment_cadence ?? 'monthly'];
  const byDate = b.first_payment_on > today ? 0 : Math.min(b.term_payments, 1 + Math.floor(monthsBetween(b.first_payment_on, today) / per));
  const early = new Set<string>();
  for (const a of paid) {
    if (!a.done || !a.done_on || a.done_on > today) continue;
    const due = dueFor(b, a.budget_month);
    if (due && due > today) early.add(due);
  }
  const made = Math.min(b.term_payments, byDate + early.size);
  const left = b.term_payments - made;
  const pay = b.monthly_payment == null ? null : Number(b.monthly_payment);
  const r = Number(b.interest_rate ?? 0) / 100 / PER_YEAR[b.payment_cadence ?? 'monthly'];
  const balance = pay === null ? null : r > 0 ? (pay * (1 - Math.pow(1 + r, -left))) / r : pay * left;
  return { made, left, lastPaymentOn: addMonthsISO(b.first_payment_on, (b.term_payments - 1) * per), balance, exact: b.interest_rate != null, ahead: made - byDate };
}

/** From "I've made N payments" back to the date of payment 1. */
export function firstPaymentFor(made: number, b: Bucket, today: string): string {
  const per = MONTHS_PER[b.payment_cadence ?? 'monthly'];
  const [y, m, d] = parse(today);
  const day = b.due_day ?? d;
  let latest = iso(y, m, day); // most recent due date on or before today
  if (latest > today) latest = addMonthsISO(latest, -1);
  // Step back to a due date on this loan's cadence, then count back.
  return made <= 0 ? addMonthsISO(latest, per) : addMonthsISO(latest, -(made - 1) * per);
}
