import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './lib/supabase';
import { loadSetup } from './lib/data';
import { defaultBudgetMonth } from './lib/format';
import type { Bucket, Tag } from './lib/types';
import { SignIn } from './components/SignIn';
import { AllocationScreen } from './components/AllocationScreen';
import { SetupScreen } from './components/SetupScreen';

type View = 'allocation' | 'setup';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<View>('allocation');
  const [month, setMonth] = useState(defaultBudgetMonth());
  const [tags, setTags] = useState<Tag[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadSetup = useCallback(async () => {
    try {
      const s = await loadSetup();
      setTags(s.tags);
      setBuckets(s.buckets);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (session) reloadSetup();
  }, [session, reloadSetup]);

  if (!configured) {
    return (
      <main className="signin">
        <h1>Almost there</h1>
        <p className="muted">The app needs its Supabase address and key. See the README.</p>
      </main>
    );
  }
  if (session === undefined) return null;
  if (!session) return <SignIn />;

  return (
    <div className="app">
      {error && <p className="error card" role="alert">{error}</p>}
      <main>
        {view === 'allocation' ? (
          <AllocationScreen month={month} setMonth={setMonth} tags={tags} buckets={buckets} />
        ) : (
          <SetupScreen tags={tags} buckets={buckets} onChange={reloadSetup} />
        )}
      </main>
      <nav className="tabbar" aria-label="Screens">
        <button aria-current={view === 'allocation' ? 'page' : undefined} onClick={() => setView('allocation')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h6" /></svg>
          Allocation
        </button>
        <button disabled title="Coming next">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></svg>
          Expenses
        </button>
        <button aria-current={view === 'setup' ? 'page' : undefined} onClick={() => setView('setup')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 12l-8 8-9-9V3h8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
          Tags
        </button>
      </nav>
    </div>
  );
}
