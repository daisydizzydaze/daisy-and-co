import { useEffect, useRef, useState } from 'react';
import { saveFx } from './data';
import { fetchRatesToHkd, rateDate } from './fx';

/**
 * Pulls and saves one rate per foreign currency per month, once, for any
 * currency used this month that doesn't have a rate yet. Returns the last error.
 */
export function useMonthFx(month: string, missing: string[], onSaved: () => void): string | null {
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const todo = missing.filter((c) => !tried.current.has(`${month}:${c}`));
    if (todo.length === 0) return;
    todo.forEach((c) => tried.current.add(`${month}:${c}`));
    (async () => {
      try {
        const rates = await fetchRatesToHkd(rateDate(month), todo);
        for (const [c, r] of Object.entries(rates)) await saveFx(month, c, r);
        setError(null);
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [missing.join(','), month, onSaved]);
  return error;
}
