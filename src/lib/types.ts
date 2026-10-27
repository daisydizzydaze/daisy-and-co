export type TagKind = 'income' | 'tax' | 'opex' | 'reserve' | 'growth' | 'expense';
export type Section = 'tax' | 'opex' | 'reserve' | 'growth';

export interface Tag {
  id: string;
  kind: TagKind;
  name: string;
  parent_id: string | null;
  default_bucket_id: string | null;
  color: string | null;
  sort: number;
  archived: boolean;
}

export interface Bucket {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  type: string;
  liquidity: string;
  unlock_age: number | null;
  is_liability: boolean;
  active: boolean;
  statement_day: number | null; // cards: day the statement closes (empty = month end)
  due_day: number | null; // cards and loans: day the payment is due
  monthly_payment: number | null; // loans: the repayment each period
  payment_cadence: 'monthly' | 'quarterly' | 'yearly';
  term_payments: number | null; // loans: e.g. 60
  first_payment_on: string | null; // loans: date of payment 1
  interest_rate: number | null; // loans: yearly %, optional
  sort: number;
}

export interface Income {
  id: string;
  received_on: string;
  budget_month: string;
  tag_id: string;
  source: string | null;
  currency: string;
  gross_amount: number;
  tax_withheld: number;
  bucket_id: string | null;
  note: string | null;
}

export interface Allocation {
  id: string;
  budget_month: string;
  section: Section;
  tag_id: string;
  currency: string;
  amount: number;
  from_bucket_id: string | null;
  to_bucket_id: string | null;
  done: boolean;
  done_on: string | null;
  note: string | null;
  sort: number;
}

export interface Expense {
  id: string;
  spent_on: string;
  budget_month: string; // calendar month of the charge
  statement_month: string | null; // month the card statement it lands on closes
  vendor: string | null;
  currency: string;
  amount: number;
  tag_id: string | null;
  paid_from: string;
  charged_amount: number | null;
  charged_currency: string | null;
  reimbursable: boolean;
  settled_on: string | null;
  note: string | null;
}

export interface Line {
  section: 'income' | Section;
  line_id: string;
  amount_hkd: number | null;
  actual_hkd: number | null;
}

export interface Statement {
  budget_month: string;
  gross_income: number;
  tax: number;
  net_income: number;
  opex_planned: number;
  opex_actual: number;
  quick_cash: number;
  growth: number;
  unallocated: number;
  saving_rate: number | null;
  missing_fx: boolean;
}

export interface FxRate {
  month: string;
  currency: string;
  rate_to_hkd: number;
}

export const CURRENCIES = ['HKD', 'SGD', 'USD', 'TWD'];

/** Account types as stored, with the names shown in the app. */
export const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'Card', label: 'Credit card' },
  { value: 'Bank', label: 'Bank account / debit card' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Brokerage', label: 'Investment' },
  { value: 'Retirement', label: 'Retirement / pension' },
  { value: 'Loan', label: 'Loan' },
  { value: 'Property', label: 'Property' },
  { value: 'Insurance', label: 'Insurance' },
  { value: 'Other', label: 'Other' },
];
export const typeLabel = (t: string) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t;
/** Paid with these, money leaves straight away, so the charge is settled at once. */
export const PAYS_AT_ONCE = ['Cash', 'Bank'];

export const KIND_LABEL: Record<TagKind, string> = {
  income: 'Income',
  tax: 'Tax',
  opex: 'Operating expenses',
  reserve: 'Quick Cash',
  growth: 'Growth',
  expense: 'Expense categories',
};
