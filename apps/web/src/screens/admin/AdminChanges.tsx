import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getChanges, undoRun, requestAction, getTree, getHiddenQuestions, unhideQuestion, getRequests, type HiddenQuestion, type ChangeRun, type AdminCategory, type AdminRequest } from '@/lib/adminApi';
import { Notice, QUEUED_MSG, UNHIDDEN_MSG, UndoHint, errorMessage, undoOnlyKind } from './CategoryList';
import { AdminNav } from './AdminNav';

export function AdminChanges() {
  const [tab, setTab] = useState<'recent' | 'hidden'>('recent');
  const [runs, setRuns] = useState<ChangeRun[] | null>(null);
  const [hidden, setHidden] = useState<AdminCategory[] | null>(null);
  const [hq, setHq] = useState<HiddenQuestion[] | null>(null);
  const [reqs, setReqs] = useState<AdminRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    getChanges().then(setRuns, (e) => setError(errorMessage(e)));
    getTree().then((t) => setHidden(t.filter((c) => c.hidden)), (e) => setError(errorMessage(e)));
    getHiddenQuestions().then(setHq, (e) => setError(errorMessage(e)));
    getRequests().then(setReqs, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, done = QUEUED_MSG) => {
    try {
      await fn();
      setToast(done);
    } catch (e) {
      setToast(errorMessage(e));
    }
  };

  return (
    <main className="mx-auto max-w-md space-y-3 p-4 pb-24">
      <AdminNav />
      <h1 className="text-xl font-semibold">Recent changes</h1>
      <div role="tablist" className="flex gap-2">
        {(['recent', 'hidden'] as const).map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
            {t === 'recent' ? 'Recent' : 'Hidden'}
          </Button>
        ))}
      </div>
      {error && <Notice text={error} />}
      {toast && <Notice text={toast} />}
      {tab === 'recent' && reqs && <RequestList reqs={reqs} />}
      {tab === 'recent' &&
        (!runs ? (
          !error && <p>Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-neutral-500">No changes yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {runs.map((r) => (
              <li key={r.runId} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 text-sm">
                  <p className="text-xs text-neutral-500">{new Date(r.at).toLocaleString()}</p>
                  {r.actions.map((a, i) => (
                    <p key={i}>{a.summary}</p>
                  ))}
                </div>
                {r.undone ? (
                  <span className="text-xs text-neutral-500">Undone</span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => act(() => undoRun(r.runId))}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ))}
      {tab === 'hidden' &&
        (!hidden ? (
          !error && <p>Loading…</p>
        ) : hidden.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing hidden.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {hidden.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <Link to={`/admin/c/${c.slug}`} className="underline">{c.name}</Link>
                  <p className="text-xs text-neutral-500">{c.hiddenReason ?? 'hidden'} · parked questions: open category</p>
                </div>
                {undoOnlyKind(c.hiddenReason) ? (
                  <UndoHint kind={undoOnlyKind(c.hiddenReason)!} />
                ) : (
                  <Button size="sm" variant="outline" aria-label={`Unhide ${c.name}`} onClick={() => act(() => requestAction('unhide', [c.slug]))}>
                    Unhide
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ))}
      {tab === 'hidden' && hq && (
        <section className="space-y-2">
          <h2 className="font-medium">Hidden questions</h2>
          <p className="text-xs text-neutral-500">
            Questions hidden because their category was dropped come back when the drop is undone (Recent tab).
          </p>
          {hq.length === 0 ? (
            <p className="text-sm text-neutral-500">No hidden questions.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {hq.map((q) => {
                const r = q.parkedReason ?? '';
                const canUnhide = (r.startsWith('owner:') && !r.startsWith('owner: dropped')) || r.startsWith('rule ');
                return (
                  <li key={q.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p>{q.text}</p>
                      <p className="text-xs text-neutral-500">{r || 'no reason'}</p>
                    </div>
                    {canUnhide && (
                      <Button size="sm" variant="outline" aria-label={`Unhide ${q.text}`} onClick={() => act(async () => { await unhideQuestion(q.id); load(); }, UNHIDDEN_MSG)}>
                        Unhide
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

const ACTION_LABEL: Record<string, string> = { merge: 'Merge', drop: 'Drop', unhide: 'Unhide', undo: 'Undo', sweep: 'Sweep' };

function requestTarget(r: AdminRequest): string {
  const p = (r.payload ?? {}) as { slugs?: unknown; runId?: unknown; ruleId?: unknown };
  if (Array.isArray(p.slugs)) return p.slugs.map(String).join(', ');
  if (p.runId !== undefined) return String(p.runId);
  if (p.ruleId !== undefined) return `rule ${String(p.ruleId)}`;
  return '';
}

/** Requests the Pi has not finished (queued/running) or could not apply (failed). Done ones show in the changes list. */
function RequestList({ reqs }: { reqs: AdminRequest[] }) {
  const open = reqs.filter((r) => r.status !== 'done');
  if (open.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Pending / failed requests</h2>
      <ul className="divide-y rounded-md border">
        {open.map((r) => (
          <li key={r.id} className="space-y-1 p-3 text-sm">
            <p>
              {ACTION_LABEL[r.action] ?? r.action} {requestTarget(r)}{' '}
              <span className={`text-xs ${r.status === 'failed' ? 'text-red-600' : 'text-neutral-500'}`}>{r.status}</span>
            </p>
            {r.result && <p className="text-xs text-neutral-500">{r.result}</p>}
            <p className="text-xs text-neutral-500">{new Date(r.createdAt).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
