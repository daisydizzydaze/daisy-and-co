import type { FormEvent } from 'react';

/** "12000.5" -> "12,000.5". Keeps only digits, one dot and a leading minus. */
export function groupDigits(raw: string): string {
  let s = raw.replace(/[^\d.-]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const dot = s.indexOf('.');
  const int = (dot >= 0 ? s.slice(0, dot) : s).replace(/^0+(?=\d)/, '');
  const dec = dot >= 0 ? '.' + s.slice(dot + 1).replace(/\./g, '') : '';
  return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec;
}

/** A number for an input box, with thousand commas. */
export const fmtNum = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '' : groupDigits(String(n)));

/** Put commas in as you type, keeping the cursor where it was. */
export function commas(e: FormEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = el.value.slice(0, caret).replace(/[^\d.]/g, '').length;
  const next = groupDigits(el.value);
  if (next === el.value) return;
  el.value = next;
  let i = 0, seen = 0;
  while (i < next.length && seen < digitsBefore) { if (/[\d.]/.test(next[i])) seen++; i++; }
  try { el.setSelectionRange(i, i); } catch { /* not focusable */ }
}
