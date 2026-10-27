import { createContext, useContext } from 'react';
import { money } from './format';

export type DisplayCurrency = 'SGD' | 'HKD';

export interface Display {
  cur: DisplayCurrency;
  /** Totals: an HKD amount shown in the chosen currency. */
  show: (hkd: number | null | undefined) => string;
  /** Second line under a total: the same amount in the other currency. */
  alt: (hkd: number | null | undefined) => string;
  /** An HKD amount shown in any currency we have a rate for. */
  inCur: (hkd: number | null | undefined, cur: string) => string;
}

/** Everything is stored and summed in HKD; this only changes how it is shown. */
export function makeDisplay(cur: DisplayCurrency, rates: Record<string, number>): Display {
  const rate = (c: string) => (c === 'HKD' ? 1 : rates[c]);
  const inCur = (hkd: number | null | undefined, c: string) =>
    hkd === null || hkd === undefined || !rate(c) ? '' : money(hkd / rate(c), c);
  const effective: DisplayCurrency = cur === 'SGD' && rate('SGD') ? 'SGD' : 'HKD';
  const other: DisplayCurrency = effective === 'SGD' ? 'HKD' : 'SGD';
  return {
    cur: effective,
    show: (hkd) => inCur(hkd, effective) || money(null),
    alt: (hkd) => inCur(hkd, other),
    inCur,
  };
}

export const DisplayContext = createContext<Display>(makeDisplay('HKD', {}));
export const useDisplay = () => useContext(DisplayContext);

const KEY = 'display-currency';
export function savedDisplay(): DisplayCurrency {
  try {
    return localStorage.getItem(KEY) === 'HKD' ? 'HKD' : 'SGD';
  } catch {
    return 'SGD';
  }
}
export function saveDisplay(c: DisplayCurrency) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* private mode */
  }
}
