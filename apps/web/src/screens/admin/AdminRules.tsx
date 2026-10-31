import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { addRule, getRules, setRuleActive, sweepRule, type AdminRule } from '@/lib/adminApi';
import { Notice, QUEUED_MSG, errorMessage } from './CategoryList';
import { AdminNav } from './AdminNav';

export function AdminRules() {
  const [rules, setRules] = useState<AdminRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState('');

  const load = useCallback(() => {
    getRules().then(setRules, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, msg: string | null, after?: () => void) => {
    try {
      await fn();
      if (msg) setToast(msg);
      after?.();
    } catch (e) {
      setToast(errorMessage(e));
    }
  };
  const trimmed = body.trim();
  const valid = trimmed.length >= 5 && trimmed.length <= 500;

  return (
    <main className="mx-auto max-w-md space-y-3 p-4 pb-24">
      <AdminNav />
      <h1 className="text-xl font-semibold">Rules</h1>
      {error && <Notice text={error} />}
      {toast && <Notice text={toast} />}
      {adding ? (
        <div className="space-y-2">
          <label className="block text-sm" htmlFor="rule-body">Rule</label>
          <textarea id="rule-body" className="w-full rounded-md border p-2 text-sm" rows={3} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!valid} onClick={() => run(() => addRule(trimmed), 'Rule saved', () => { setAdding(false); setBody(''); load(); })}>
              Save rule
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAdding(false); setBody(''); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setAdding(true)}>New rule</Button>
      )}
      {!rules ? (
        !error && <p>Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-neutral-500">No rules yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rules.map((r) => (
            <li key={r.id} className="space-y-2 p-3 text-sm">
              <p>{r.body}</p>
              <p className="text-xs text-neutral-500">
                {r.lastSweep ? `Last sweep: ${r.lastSweep.status} (${r.lastSweep.proposed} proposed)` : 'Never swept'}
              </p>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input type="checkbox" aria-label={`Active: ${r.body}`} checked={r.active} onChange={(e) => run(() => setRuleActive(r.id, e.target.checked), null, load)} />
                  Active
                </label>
                <Button size="sm" variant="outline" onClick={() => run(() => sweepRule(r.id), QUEUED_MSG)}>
                  Sweep now
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
