const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** First day of a month as 'YYYY-MM-01'. */
export function monthKey(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(y, m - 1 + n);
}

export function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthOnly(key: string): string {
  return MONTHS[Number(key.split('-')[1]) - 1];
}

export function shortMonth(key: string): string {
  return MONTHS[Number(key.split('-')[1]) - 1].slice(0, 3);
}

/** Pay landing from the 20th onwards funds next month, so that's the month to open by default. */
export function defaultBudgetMonth(today = new Date()): string {
  return monthKey(today.getFullYear(), today.getMonth() + (today.getDate() >= 20 ? 1 : 0));
}

/** Salary funds the month after it lands; everything else counts in the month it lands. */
export function budgetMonthFor(receivedOn: string, isSalary: boolean): string {
  const [y, m] = receivedOn.split('-').map(Number);
  return monthKey(y, m - 1 + (isSalary ? 1 : 0));
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const SYMBOL: Record<string, string> = {
  HKD: 'HK$', SGD: 'S$', USD: 'US$', TWD: 'NT$', CNY: 'RMB ', EUR: '€', GBP: '£', JPY: 'JP¥', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', CHF: 'CHF ', KRW: '₩', MYR: 'RM ', THB: '฿',
};

export function money(n: number | null | undefined, currency = 'HKD', digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '−' : ''}${SYMBOL[currency] ?? currency + ' '}${s}`;
}

export function pct(r: number | null | undefined): string {
  if (r === null || r === undefined) return '–';
  return `${(r * 100).toFixed(1)}%`;
}

/** Mirrors statement_month_for in the database: a charge after the closing day goes on next month's statement. */
export function statementMonth(spentOn: string, closingDay: number | null | undefined): string {
  const [y, m, d] = spentOn.split('-').map(Number);
  return monthKey(y, m - 1 + (closingDay && d > closingDay ? 1 : 0));
}

/** "5 Nov" for a day in a month, clamped to the month's length. */
export function dayIn(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${Math.min(day, last)} ${shortMonth(month)}`;
}

export function thisMonth(today = new Date()): string {
  return monthKey(today.getFullYear(), today.getMonth());
}
