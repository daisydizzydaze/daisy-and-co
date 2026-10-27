import { useEffect, useRef, useState } from 'react';

export interface Option { value: string; label: string; divider?: boolean }

/** A dropdown drawn by the app (not the browser), so it matches the pastel style everywhere. */
export function Select({ value, onChange, options, label, placeholder = 'Choose…', className = '' }: {
  value: string; onChange: (v: string) => void; options: Option[]; label?: string; placeholder?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function show() {
    const r = box.current?.getBoundingClientRect();
    if (r) {
      setAlignRight(r.left + Math.max(r.width, 220) > window.innerWidth - 12);
      setUp(r.bottom + 290 > window.innerHeight && r.top > 300);
    }
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function pick(v: string) {
    setOpen(false);
    btn.current?.focus();
    if (v !== value) onChange(v);
  }
  function key(e: React.KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active].value); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  }

  return (
    <div className={`selectfield ${className}`} ref={box} onKeyDown={key}>
      <button ref={btn} type="button" className={`select-btn ${current ? '' : 'empty'}`} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}>
        <span className="select-value">{current?.label ?? placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul ref={list} className={`select-pop ${alignRight ? 'right' : ''} ${up ? 'up' : ''}`} role="listbox" aria-label={label} onClick={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <li key={o.value} data-i={i} role="option" aria-selected={o.value === value}
              className={`${o.value === value ? 'on' : ''} ${i === active ? 'active' : ''} ${o.divider ? 'divider' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}>
              <span>{o.label}</span>
              {o.value === value && <span aria-hidden="true">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
