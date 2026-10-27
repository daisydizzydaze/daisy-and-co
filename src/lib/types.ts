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
  is_liability: boolean;
  active: boolean;
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

export const KIND_LABEL: Record<TagKind, string> = {
  income: 'Income',
  tax: 'Tax',
  opex: 'Operating expenses',
  reserve: 'Quick Cash',
  growth: 'Growth',
  expense: 'Expense categories',
};
