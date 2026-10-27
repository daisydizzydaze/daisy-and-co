import { useState } from 'react';
import { DateField } from './DateField';
import { insertBucket, removeGroup, save, saveCurrencies, saveGroup } from '../lib/data';
import { fetchRatesToHkd } from '../lib/fx';
import { money, monthName, todayISO } from '../lib/format';
import { firstPaymentFor, loanStatus } from '../lib/loan';
import { supabase } from '../lib/supabase';
import { ACCOUNT_TYPES, CURRENCIES, currencyLabel, KIND_LABEL, type AccountGroup, type Bucket, type Tag, type TagKind } from '../lib/types';

const KINDS: TagKind[] = ['income', 'tax', 'opex', 'reserve', 'growth', 'expense'];
const LINKED: TagKind[] = ['opex', 'reserve', 'growth'];
const LIQUIDITY = ['Liquid', 'Locked until age', 'Illiquid'];

export function SetupScreen({ tags, buckets, groups: saved, onChange }: { tags: Tag[]; buckets: Bucket[]; groups: AccountGroup[]; onChange: () => void }) {
  const [tab, setTab] = useState<'tags' | 'accounts' | 'groups' | 'currencies'>('accounts');
  // Before migration 004 there are no saved groups: use the built-in ones.
  const groups = saved.length ? saved : FALLBACK_GROUPS;
  const hasGroups = saved.length > 0;
  const [error, setError] = useState<string | null>(null);

  // Always reload afterwards, so anything that did save shows up even if a later step failed.
  async function run(fn: () => Promise<void>): Promise<boolean> {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(friendly((e as Error).message));
      return false;
    } finally {
      onChange();
    }
  }

  return (
    <div className="screen">
      <header className="month-nav">
        <div className="month-title left">
          <span className="eyebrow">Settings</span>
          <h1>Accounts &amp; tags</h1>
        </div>
        <button className="btn ghost small-btn push-right" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <div className="segmented four" role="tablist">
        <button role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>Accounts</button>
        <button role="tab" aria-selected={tab === 'groups'} onClick={() => setTab('groups')}>Groups</button>
        <button role="tab" aria-selected={tab === 'currencies'} onClick={() => setTab('currencies')}>Currencies</button>
        <button role="tab" aria-selected={tab === 'tags'} onClick={() => setTab('tags')}>Tags</button>
      </div>

      {error && <p className="error card" role="alert">{error}</p>}

      {tab === 'tags' ? (
        <div className="tag-groups">
          {KINDS.map((k) => (
            <TagGroup key={k} kind={k} tags={tags.filter((t) => t.kind === k)} buckets={buckets} run={run} />
          ))}
        </div>
      ) : tab === 'groups' ? (
        <Groups groups={groups} hasGroups={hasGroups} buckets={buckets} run={run} />
      ) : tab === 'currencies' ? (
        <Currencies buckets={buckets} run={run} />
      ) : (
        <Accounts buckets={buckets} tags={tags} groups={groups} hasGroups={hasGroups} run={run} error={error} />
      )}
    </div>
  );
}

type Run = (fn: () => Promise<void>) => Promise<boolean>;

/** Turn database errors into something readable. */
function friendly(msg: string): string {
  if (msg.includes('buckets_user_id_name_key')) return 'You already have an account with that name. It may be a closed one: tap "Show closed" below to reopen it, or pick another name.';
  if (msg.includes('tags_user_id_kind_name_key')) return 'There’s already a tag with that name in this group. Pick another name.';
  if (msg.includes('account_groups_user_id_name_key')) return 'You already have a group with that name.';
  if (msg.includes('shares') || msg.includes('price_per_share') || msg.includes('price_on') || msg.includes('base_type_check')) return 'The database needs the latest update first. Run 005_private_equity.sql in the Supabase SQL Editor.';
  if (msg.includes('account_groups') || msg.includes('group_id') || msg.includes('surrender_value') || msg.includes('currencies')) return 'The database needs the latest update first. Run 004_groups_currencies.sql in the Supabase SQL Editor.';
  if (msg.includes('buckets_type_check')) return 'The database needs the latest update before it can save this type. Run the newest scripts (003, 004, 005) in the Supabase SQL Editor.';
  return msg;
}

function TagGroup({ kind, tags, buckets, run }: { kind: TagKind; tags: Tag[]; buckets: Bucket[]; run: Run }) {
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const live = tags.filter((t) => !t.archived);
  const archived = tags.filter((t) => t.archived);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    run(() => save('tags', { kind, name: name.trim(), sort: tags.length + 1 }));
    setName('');
  }

  return (
    <section className="card stack">
      <h2>{KIND_LABEL[kind]}</h2>
      <ul className="tag-list">
        {(showArchived ? [...live, ...archived] : live).map((t) => (
          <li key={t.id} className={t.archived ? 'archived' : ''}>
            <input
              aria-label={`Rename ${t.name}`}
              defaultValue={t.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(() => save('tags', { name: e.target.value.trim() }, t.id))}
            />
            {LINKED.includes(kind) && (
              <select
                aria-label={`Account for ${t.name}`}
                value={t.default_bucket_id ?? ''}
                onChange={(e) => run(() => save('tags', { default_bucket_id: e.target.value || null }, t.id))}
              >
                <option value="">No account</option>
                {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button className="btn ghost small-btn" onClick={() => run(() => save('tags', { archived: !t.archived }, t.id))}>
              {t.archived ? 'Restore' : 'Archive'}
            </button>
          </li>
        ))}
      </ul>
      <form className="add-row" onSubmit={add}>
        <input placeholder={`New ${KIND_LABEL[kind].toLowerCase()} tag`} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary small-btn">Add</button>
      </form>
      {archived.length > 0 && (
        <button className="link" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide archived' : `Show ${archived.length} archived`}
        </button>
      )}
    </section>
  );
}

function Accounts({ buckets, tags, groups, hasGroups, run, error }: { buckets: Bucket[]; tags: Tag[]; groups: AccountGroup[]; hasGroups: boolean; run: Run; error: string | null }) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  // Cards start folded; a new one opens so you can fill it in.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [groupId, setGroupIdRaw] = useState(groups[0]?.id ?? '');
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const [currency, setCurrency] = useState('HKD');
  const [liquidity, setLiquidity] = useState(defaultLiquidity(group?.base_type ?? 'Card'));
  const setGroupId = (id: string) => { setGroupIdRaw(id); setLiquidity(defaultLiquidity(groups.find((g) => g.id === id)?.base_type ?? 'Other')); };

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !group) return;
    const n = name.trim();
    const same = buckets.find((b) => b.name.toLowerCase() === n.toLowerCase());
    if (same) {
      setLocalError(same.active
        ? `You already have an account called “${same.name}”. Pick another name, e.g. “${n} 2”.`
        : `“${same.name}” is a closed account. Reopen it below, or pick another name.`);
      if (!same.active) setShowClosed(true);
      return;
    }
    setLocalError(null);
    const type = group.base_type;
    run(async () => {
      const id = await insertBucket({ name: n, currency, type, liquidity, is_liability: isLiability(type), sort: buckets.length + 1, ...(hasGroups ? { group_id: group.id } : {}) });
      await ensureBillLine(id, n, type, tags);
      setOpenIds((s) => new Set(s).add(id));
    }).then((ok) => ok && setName(''));
  }

  const open = buckets.filter((b) => b.active);
  const closed = buckets.filter((b) => !b.active);
  const groupOf = (b: Bucket) => groups.find((g) => g.id === b.group_id) ?? groups.find((g) => g.base_type === b.type) ?? groups[groups.length - 1];
  const order = (b: Bucket) => (groupOf(b)?.sort ?? 999) * 1000 + b.sort;
  const sections = LIQUIDITY.map((l) => ({ l, items: open.filter((b) => (LIQUIDITY.includes(b.liquidity) ? b.liquidity : 'Liquid') === l).sort((a, b) => order(a) - order(b)) }))
    .filter((x) => x.items.length > 0);
  const anyOpen = open.some((b) => openIds.has(b.id));
  const card = (b: Bucket) => (
    <AccountCard key={b.id} b={b} tags={tags} groups={groups} group={groupOf(b)} hasGroups={hasGroups} run={run}
      open={openIds.has(b.id)} onToggle={() => toggle(b.id)} />
  );

  return (
    <div className="stack">
      <div className="acct-intro">
        <p className="muted small">Only Liquid counts toward your freedom number. Tap an account to edit it.</p>
        {open.length > 0 && (
          <button className="link small" onClick={() => setOpenIds(anyOpen ? new Set() : new Set(open.map((b) => b.id)))}>
            {anyOpen ? 'Fold all' : 'Open all'}
          </button>
        )}
      </div>
      {sections.map(({ l, items }) => (
        <section key={l} className="stack" aria-label={l}>
          <h2 className={`group-title l-${l.split(' ')[0]}`}>{LIQUIDITY_TITLE[l] ?? l} <span className="muted small">{items.length}</span></h2>
          <div className="acct-grid">{items.map(card)}</div>
        </section>
      ))}

      <form className="card stack acct-new" onSubmit={add}>
        <h2>Add an account</h2>
        <input placeholder="Name, e.g. DBS Multiplier" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid3">
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
          </select>
          <select aria-label="Group" value={group?.id ?? ''} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select aria-label="Liquidity" value={liquidity} onChange={(e) => setLiquidity(e.target.value)}>
            {LIQUIDITY.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {(localError || error) && <p className="error" role="alert">{localError || error}</p>}
        <button className="btn primary">Add account</button>
      </form>

      {closed.length > 0 && (
        <>
          <button className="link" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide closed accounts' : `Show ${closed.length} closed`}
          </button>
          {showClosed && <div className="acct-grid">{closed.map(card)}</div>}
        </>
      )}
    </div>
  );
}

/** Used until migration 004 adds saved groups. */
const FALLBACK_GROUPS: AccountGroup[] = [
  { id: 'Card', name: 'Credit cards', base_type: 'Card', sort: 10, starter: true },
  { id: 'Bank', name: 'Bank accounts and debit cards', base_type: 'Bank', sort: 20, starter: true },
  { id: 'Cash', name: 'Cash', base_type: 'Cash', sort: 30, starter: true },
  { id: 'Loan', name: 'Loans', base_type: 'Loan', sort: 40, starter: true },
  { id: 'Brokerage', name: 'Investments', base_type: 'Brokerage', sort: 50, starter: true },
  { id: 'Equity', name: 'Private equity', base_type: 'Equity', sort: 55, starter: true },
  { id: 'Retirement', name: 'Retirement and pension', base_type: 'Retirement', sort: 60, starter: true },
  { id: 'Property', name: 'Property', base_type: 'Property', sort: 70, starter: true },
  { id: 'Insurance', name: 'Insurance', base_type: 'Insurance', sort: 80, starter: true },
  { id: 'Other', name: 'Other', base_type: 'Other', sort: 90, starter: true },
];

const isLiability = (type: string) => type === 'Card' || type === 'Loan';
const defaultLiquidity = (type: string) => (type === 'Retirement' ? 'Locked until age' : type === 'Property' || type === 'Equity' ? 'Illiquid' : 'Liquid');
const LIQUIDITY_TITLE: Record<string, string> = { Liquid: 'Liquid', 'Locked until age': 'Locked until an age', Illiquid: 'Illiquid' };

const ordinal = (d: number) => `${d}${[11, 12, 13].includes(d % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th'}`;

/** One line that sums up a folded card. */
function summary(b: Bucket): string {
  switch (b.type) {
    case 'Card':
      return `Closes ${b.statement_day ? ordinal(b.statement_day) : 'month end'}${b.due_day ? ` · due ${ordinal(b.due_day)}` : ''}`;
    case 'Loan': {
      const st = loanStatus(b, todayISO());
      if (!st) return 'Add the repayment details';
      return `${st.made} of ${st.made + st.left} paid${st.balance !== null ? ` · ${money(st.balance, b.currency)} left` : ''}`;
    }
    case 'Insurance':
      return b.surrender_value != null ? `Surrender value ${money(b.surrender_value, b.currency)}` : 'Surrender value not set';
    case 'Equity':
      if (b.shares == null) return 'Add the number of shares';
      return `${b.shares.toLocaleString('en-US')} ${b.share_class ? b.share_class.toLowerCase() + ' ' : ''}shares · ${b.price_per_share != null ? money(b.shares * b.price_per_share, b.currency) : 'value unknown'}`;
    default:
      return b.liquidity === 'Locked until age' ? (b.unlock_age ? `Unlocks at ${b.unlock_age}` : 'Add the unlock age') : '';
  }
}

/** Credit cards and loans each get their own bill line under Operating expenses. */
async function ensureBillLine(id: string, name: string, type: string, tags: Tag[]) {
  if (!isLiability(type) || tags.some((t) => t.kind === 'opex' && t.default_bucket_id === id)) return;
  const base = `${name} ${type === 'Card' ? 'bill' : 'repayment'}`;
  const taken = new Set(tags.filter((t) => t.kind === 'opex').map((t) => t.name.toLowerCase()));
  let line = base;
  for (let i = 2; taken.has(line.toLowerCase()); i++) line = `${base} ${i}`;
  await save('tags', { kind: 'opex', name: line, default_bucket_id: id, sort: tags.length + 1 });
}

function AccountCard({ b, tags, groups, group, hasGroups, run, open, onToggle }: {
  b: Bucket; tags: Tag[]; groups: AccountGroup[]; group?: AccountGroup; hasGroups: boolean; run: Run; open: boolean; onToggle: () => void;
}) {
  const set = (row: Record<string, unknown>) => run(() => save('buckets', row, b.id));
  function moveTo(id: string) {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    const type = g.base_type;
    run(async () => {
      await save('buckets', { type, is_liability: isLiability(type), ...(hasGroups ? { group_id: g.id } : {}) }, b.id);
      await ensureBillLine(b.id, b.name, type, tags);
    });
  }
  const label = group?.name ?? typeName(b.type);
  if (!open) {
    const line = summary(b);
    return (
      <article className={`card acct folded t-${b.type} ${b.active ? '' : 'archived'}`}>
        <button className="acct-fold" aria-expanded={false} onClick={onToggle}>
          <span className="acct-badge">{currencyLabel(b.currency)}</span>
          <span className="acct-title">
            <strong>{b.name}</strong>
            <span className="small muted">{label}{line ? ` · ${line}` : ''}</span>
          </span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
      </article>
    );
  }
  return (
    <article className={`card acct t-${b.type} ${b.active ? '' : 'archived'}`}>
      <div className="acct-head">
        <span className="acct-badge">{currencyLabel(b.currency)}</span>
        <input
          className="acct-name"
          aria-label={`Rename ${b.name}`}
          defaultValue={b.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== b.name && set({ name: e.target.value.trim() })}
        />
      </div>
      <div className="acct-fields">
        <select aria-label={`Group of ${b.name}`} value={group?.id ?? ''} onChange={(e) => moveTo(e.target.value)}>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select aria-label={`Currency of ${b.name}`} value={b.currency} onChange={(e) => set({ currency: e.target.value })}>
          {[...new Set([...CURRENCIES, b.currency])].map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
        </select>
        <select aria-label={`Liquidity of ${b.name}`} value={b.liquidity} onChange={(e) => set({ liquidity: e.target.value })}>
          {LIQUIDITY.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {b.liquidity === 'Locked until age' && (
        <label className="field inline">
          <span>Unlocks at age</span>
          <input inputMode="numeric" placeholder="e.g. 62" defaultValue={b.unlock_age ?? ''}
            onBlur={(e) => { const v = e.target.value === '' ? null : Math.round(Number(e.target.value)); if (v !== b.unlock_age) set({ unlock_age: v }); }} />
        </label>
      )}
      {b.active && (b.type === 'Card' || b.type === 'Loan') && <AccountDates b={b} run={run} />}
      {b.active && b.type === 'Insurance' && <SurrenderValue b={b} run={run} />}
      {b.active && b.type === 'Equity' && <Shares b={b} run={run} />}
      <div className="acct-meta">
        <span className="muted small">{group && group.starter === false ? `Works like: ${typeName(b.type)}` : ''}</span>
        <span className="acct-actions">
          <button className="link small" onClick={() => set({ active: !b.active })}>
            {b.active ? 'Close account' : 'Reopen'}
          </button>
          <button className="btn ghost small-btn" onClick={onToggle}>Done</button>
        </span>
      </div>
    </article>
  );
}

const typeName = (t: string) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t;

/** Insurance: what you'd get back if you surrendered the policy, and when you checked. */
function SurrenderValue({ b, run }: { b: Bucket; run: Run }) {
  const saveIf = (field: keyof Bucket, v: unknown) => v !== b[field] && run(() => save('buckets', { [field]: v }, b.id));
  return (
    <div className="account-dates">
      <label className="field">
        <span>Surrender value ({currencyLabel(b.currency)})</span>
        <input inputMode="decimal" placeholder="0" defaultValue={b.surrender_value ?? ''}
          onBlur={(e) => saveIf('surrender_value', e.target.value.trim() === '' ? null : Number(e.target.value.replace(/,/g, '')))} />
      </label>
      <label className="field">
        <span>As of</span>
        <DateField label="Surrender value as of" value={b.surrender_value_on ?? ''} onChange={(v) => saveIf('surrender_value_on', v || null)} />
      </label>
    </div>
  );
}

/** Private equity: shares held. The value is optional; leave it blank if you don't know it. */
function Shares({ b, run }: { b: Bucket; run: Run }) {
  const saveIf = (field: keyof Bucket, v: unknown) => v !== b[field] && run(() => save('buckets', { [field]: v }, b.id));
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  return (
    <>
      <div className="account-dates">
        <label className="field">
          <span>Shares held</span>
          <input inputMode="decimal" placeholder="e.g. 12,000" defaultValue={b.shares ?? ''} onBlur={(e) => saveIf('shares', numOrNull(e.target.value))} />
        </label>
        <label className="field">
          <span>Share class <em className="muted">(optional)</em></span>
          <input list="share-classes" placeholder="e.g. Ordinary" defaultValue={b.share_class ?? ''} onBlur={(e) => saveIf('share_class', e.target.value.trim() || null)} />
          <datalist id="share-classes">
            <option value="Ordinary" /><option value="Preferred" /><option value="Options" /><option value="RSUs" />
          </datalist>
        </label>
        <label className="field">
          <span>Value per share ({currencyLabel(b.currency)}) <em className="muted">(optional)</em></span>
          <input inputMode="decimal" placeholder="Unknown" defaultValue={b.price_per_share ?? ''} onBlur={(e) => saveIf('price_per_share', numOrNull(e.target.value))} />
        </label>
        <label className="field">
          <span>As of <em className="muted">(e.g. last round)</em></span>
          <DateField label="Value as of" value={b.price_on ?? ''} onChange={(v) => saveIf('price_on', v || null)} />
        </label>
      </div>
      {b.shares != null && (
        <div className="loan-summary">
          <span className="small">
            {b.price_per_share != null
              ? <>Worth about <strong className="num">{money(b.shares * b.price_per_share, b.currency)}</strong></>
              : <><strong>Value unknown.</strong> <span className="muted">Kept as shares only and left out of totals until you add a value.</span></>}
          </span>
        </div>
      )}
    </>
  );
}

/** Your own account groups: rename, reorder, choose what each works like. */
function Groups({ groups, hasGroups, buckets, run }: { groups: AccountGroup[]; hasGroups: boolean; buckets: Bucket[]; run: Run }) {
  const [name, setName] = useState('');
  const [base, setBase] = useState('Brokerage');
  if (!hasGroups) {
    return (
      <section className="card stack">
        <h2>Groups</h2>
        <p className="muted">To add your own groups, run <strong>004_groups_currencies.sql</strong> in the Supabase SQL Editor, then refresh.</p>
      </section>
    );
  }
  const count = (id: string) => buckets.filter((b) => b.group_id === id).length;
  const [showUnused, setShowUnused] = useState(false);
  const unused = groups.filter((g) => g.starter && count(g.id) === 0);
  const shown = showUnused ? groups : groups.filter((g) => !unused.includes(g));
  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const sort = Math.max(0, ...groups.map((g) => g.sort)) + 10;
    run(() => saveGroup({ name: name.trim(), base_type: base, sort })).then((ok) => ok && setName(''));
  }
  function move(i: number, dir: -1 | 1) {
    const a = groups[i], b = groups[i + dir];
    if (!a || !b) return;
    run(async () => {
      await saveGroup({ sort: b.sort }, a.id);
      await saveGroup({ sort: a.sort === b.sort ? b.sort + dir : a.sort }, b.id);
    });
  }
  return (
    <div className="stack">
      <p className="muted small">Groups label each account and, later, break down Net Worth. "Works like" decides how its accounts behave, e.g. credit cards get a bill line and loans get a schedule.</p>
      <ul className="group-list">
        {shown.map((g) => { const i = groups.indexOf(g); return (
          <li key={g.id} className={`card t-${g.base_type}`}>
            <span className="swatch" aria-hidden="true" />
            <input aria-label={`Rename ${g.name}`} defaultValue={g.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== g.name && run(() => saveGroup({ name: e.target.value.trim() }, g.id))} />
            <select aria-label={`${g.name} works like`} value={g.base_type} onChange={(e) => run(() => saveGroup({ base_type: e.target.value }, g.id))}>
              {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <span className="muted small nowrap">{count(g.id)} {count(g.id) === 1 ? 'account' : 'accounts'}</span>
            <span className="group-actions">
              <button className="icon-btn small" aria-label={`Move ${g.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="icon-btn small" aria-label={`Move ${g.name} down`} disabled={i === groups.length - 1} onClick={() => move(i, 1)}>↓</button>
              {count(g.id) === 0 && <button className="link small" onClick={() => run(() => removeGroup(g.id))}>Delete</button>}
            </span>
          </li>
        ); })}
      </ul>
      {unused.length > 0 && (
        <button className="link" onClick={() => setShowUnused(!showUnused)}>
          {showUnused ? 'Hide unused built-in groups' : `Show ${unused.length} unused built-in groups`}
        </button>
      )}
      <form className="card stack acct-new" onSubmit={add}>
        <h2>Add a group</h2>
        <input placeholder="e.g. Alternative Investment" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="field">
          <span>Works like</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <button className="btn primary">Add group</button>
      </form>
    </div>
  );
}

/** The currencies offered in every picker. */
function Currencies({ buckets, run }: { buckets: Bucket[]; run: Run }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inUse = new Set(buckets.map((b) => b.currency));
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase() === 'RMB' ? 'CNY' : code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return setErr('Use the 3-letter code, e.g. CNY for RMB, JPY, EUR.');
    if (CURRENCIES.includes(c)) return setErr(`${currencyLabel(c)} is already on the list.`);
    setBusy(true);
    setErr(null);
    try {
      const got = await fetchRatesToHkd('latest', [c]);
      if (!got[c]) throw new Error('unknown');
    } catch {
      setBusy(false);
      return setErr(`Couldn’t find exchange rates for ${c}. Check the code.`);
    }
    const ok = await run(() => saveCurrencies([...CURRENCIES, c]));
    setBusy(false);
    if (ok) setCode('');
  }
  return (
    <div className="stack">
      <section className="card stack">
        <h2>Your currencies</h2>
        <p className="muted small">These show up in every currency picker. Rates are pulled once a month and saved. Amounts are always added up in HKD.</p>
        <ul className="cur-list">
          {CURRENCIES.map((c) => (
            <li key={c} className="chip on">
              <strong>{currencyLabel(c)}</strong>{c === 'CNY' && <span className="muted small"> CNY</span>}
              {c !== 'HKD' && !inUse.has(c) && (
                <button className="x" aria-label={`Remove ${currencyLabel(c)}`} onClick={() => run(() => saveCurrencies(CURRENCIES.filter((x) => x !== c)))}>×</button>
              )}
            </li>
          ))}
        </ul>
        <form className="add-row" onSubmit={add}>
          <input aria-label="Currency code" placeholder="Add a code, e.g. JPY, EUR" value={code} maxLength={3} onChange={(e) => setCode(e.target.value)} />
          <button className="btn primary small-btn" disabled={busy}>{busy ? 'Checking…' : 'Add'}</button>
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        <p className="muted small">A currency used by one of your accounts can’t be removed.</p>
      </section>
    </div>
  );
}

/** Card: when the statement closes and when it's due. Loan: repayment schedule and balance. */
function AccountDates({ b, run }: { b: Bucket; run: Run }) {
  const day = (v: string) => (v === '' ? null : Math.min(31, Math.max(1, Math.round(Number(v)))));
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  const saveIf = (field: keyof Bucket, v: unknown) => v !== b[field] && run(() => save('buckets', { [field]: v }, b.id));

  if (b.type === 'Card') {
    return (
      <div className="account-dates">
        <label className="field">
          <span>Statement closes (day)</span>
          <input inputMode="numeric" placeholder="Month end" defaultValue={b.statement_day ?? ''} onBlur={(e) => saveIf('statement_day', day(e.target.value))} />
        </label>
        <label className="field">
          <span>Payment due (day)</span>
          <input inputMode="numeric" placeholder="e.g. 5" defaultValue={b.due_day ?? ''} onBlur={(e) => saveIf('due_day', day(e.target.value))} />
        </label>
      </div>
    );
  }

  const today = todayISO();
  const st = loanStatus(b, today);
  return (
    <>
      <div className="account-dates">
        <label className="field">
          <span>Repayment ({b.currency})</span>
          <input inputMode="decimal" placeholder="0" defaultValue={b.monthly_payment ?? ''} onBlur={(e) => saveIf('monthly_payment', numOrNull(e.target.value))} />
        </label>
        <label className="field">
          <span>How often</span>
          <select value={b.payment_cadence ?? 'monthly'} onChange={(e) => saveIf('payment_cadence', e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label className="field">
          <span>Payments made</span>
          <input key={`made-${st?.made}`} inputMode="numeric" placeholder="e.g. 25" defaultValue={st?.made ?? ''}
            onBlur={(e) => { if (e.target.value !== '' && Number(e.target.value) !== st?.made) saveIf('first_payment_on', firstPaymentFor(Math.round(Number(e.target.value)), b, today)); }} />
        </label>
        <label className="field">
          <span>Out of (total)</span>
          <input inputMode="numeric" placeholder="e.g. 60" defaultValue={b.term_payments ?? ''} onBlur={(e) => saveIf('term_payments', numOrNull(e.target.value))} />
        </label>
        <label className="field">
          <span>Due (day)</span>
          <input inputMode="numeric" placeholder="e.g. 15" defaultValue={b.due_day ?? ''} onBlur={(e) => saveIf('due_day', day(e.target.value))} />
        </label>
        <label className="field">
          <span>Interest, % a year <em className="muted">(optional)</em></span>
          <input inputMode="decimal" placeholder="e.g. 3.5" defaultValue={b.interest_rate ?? ''} onBlur={(e) => saveIf('interest_rate', numOrNull(e.target.value))} />
        </label>
      </div>
      {st && (
        <div className="loan-summary">
          <div className="meter" aria-hidden="true"><span className="grow" style={{ width: `${(st.made / (st.made + st.left)) * 100}%` }} /></div>
          <span className="small"><strong>{st.made} of {st.made + st.left}</strong> paid · last payment {monthName(st.lastPaymentOn.slice(0, 8) + '01')}</span>
          {st.balance !== null && (
            <span className="small">
              Balance <strong className="num">{money(st.balance, b.currency)}</strong>
              <span className="muted">{st.exact ? '' : ' (repayments left; add the interest rate for the exact figure)'}</span>
            </span>
          )}
        </div>
      )}
    </>
  );
}
