import { useEffect, useRef, useState } from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };

/** "31 Dec 2025" */
export function prettyDate(v: string): string {
  const [y, m, d] = v.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/** A date input with our own calendar, so it matches the rest of the app. Value is YYYY-MM-DD or ''. */
export function DateField({ value, onChange, required, placeholder = 'Pick a date', label }: {
  value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months'>('days');
  const start = value || todayIso();
  const [y, setY] = useState(Number(start.slice(0, 4)));
  const [m, setM] = useState(Number(start.slice(5, 7)) - 1);
  const box = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  function toggle() {
    if (!open) {
      const s = value || todayIso();
      setY(Number(s.slice(0, 4)));
      setM(Number(s.slice(5, 7)) - 1);
      setView('days');
      // Open towards whichever side has room.
      const r = box.current?.getBoundingClientRect();
      setAlignRight(!!r && r.left + 296 > window.innerWidth - 12);
    }
    setOpen(!open);
  }
  function step(dir: -1 | 1) {
    if (view === 'months') return setY(y + dir);
    const n = m + dir;
    setM((n + 12) % 12);
    if (n < 0) setY(y - 1);
    if (n > 11) setY(y + 1);
  }
  function pick(v: string) { onChange(v); setOpen(false); }

  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayIso();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <div className="datefield" ref={box}>
      <button type="button" className={`date-btn ${value ? '' : 'empty'}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <span>{value ? prettyDate(value) : placeholder}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {required && <input className="date-required" tabIndex={-1} required value={value} onChange={() => {}} aria-hidden="true" />}
      {open && (
        <div className={`date-pop ${alignRight ? 'right' : ''}`} role="dialog" aria-label="Choose a date" onClick={(e) => e.preventDefault()}>
          <div className="date-head">
            <button type="button" className="date-title" onClick={() => setView(view === 'days' ? 'months' : 'days')}>
              {view === 'days' ? `${MONTHS[m]} ${y}` : y} <span aria-hidden="true">▾</span>
            </button>
            <span className="date-steps">
              <button type="button" className="icon-btn small" aria-label={view === 'days' ? 'Previous month' : 'Previous year'} onClick={() => step(-1)}>‹</button>
              <button type="button" className="icon-btn small" aria-label={view === 'days' ? 'Next month' : 'Next year'} onClick={() => step(1)}>›</button>
            </span>
          </div>
          {view === 'days' ? (
            <div className="date-grid">
              {DAYS.map((d, i) => <span key={i} className="date-dow">{d}</span>)}
              {cells.map((d, i) => {
                if (d === null) return <span key={i} />;
                const v = iso(y, m, d);
                return (
                  <button type="button" key={i} className={`date-day ${v === value ? 'on' : ''} ${v === today ? 'today' : ''}`} aria-pressed={v === value} onClick={() => pick(v)}>
                    {d}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="date-months">
              {MONTHS.map((name, i) => (
                <button type="button" key={name} className={`date-month ${i === m ? 'on' : ''}`} onClick={() => { setM(i); setView('days'); }}>{name.slice(0, 3)}</button>
              ))}
            </div>
          )}
          <div className="date-foot">
            {!required && value ? <button type="button" className="link small" onClick={() => pick('')}>Clear</button> : <span />}
            <button type="button" className="link small" onClick={() => pick(today)}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
