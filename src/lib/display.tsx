import { createContext, useContext } from 'react';
import { money } from './format';

export type DisplayCurrency = 'SGD' | 'HKD';

export interface Display {
  cur: DisplayCurrency;
  /** Main figure: an HKD amount shown in the chosen currency. */
  show: (hkd: number | null | undefined) => string;
  /** Second line: the same amount in the other currency. */
  alt: (hkd: number | null | undefined) => string;
}

/** Everything is stored and summed in HKD; this only changes how it is shown. */
export function makeDisplay(cur: DisplayCurrency, sgdRate: number | null): Display {
  const effective: DisplayCurrency = cur === 'SGD' && sgdRate ? 'SGD' : 'HKD';
  const conv = (hkd: number | null | undefined, c: DisplayCurrency) =>
    hkd === null || hkd === undefined ? null : c === 'HKD' ? hkd : hkd / (sgdRate as number);
  const other: DisplayCurrency = effective === 'SGD' ? 'HKD' : 'SGD';
  return {
    cur: effective,
    show: (hkd) => money(conv(hkd, effective), effective),
    alt: (hkd) => (other === 'SGD' && !sgdRate ? '' : money(conv(hkd, other), other)),
  };
}

export const DisplayContext = createContext<Display>(makeDisplay('HKD', null));
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
