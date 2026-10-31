import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getSweeps, keepProposals, type AdminSweep } from '@/lib/adminApi';
import { Notice, errorMessage } from './CategoryList';
import { AdminNav } from './AdminNav';

function countdown(iso: string | null, noticeSentAt: string | null): string | null {
  if (!noticeSentAt) return 'awaiting notice';
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'hiding now';
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  return `hidden in ${h}h ${m}m unless kept`;
}

function SweepCard({ sweep, onKept }: { sweep: AdminSweep; onKept: (msg: string) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const keep = async () => {
    try {
      const r = await keepProposals(sweep.id, [...sel]);
      setSel(new Set());
      onKept(`Kept ${r.kept}`);
    } catch (e) {
      onKept(errorMessage(e));
    }
  };
  const cd = countdown(sweep.executeAfter, sweep.noticeSentAt);
  return (
    <section className="space-y-2 rounded-md border p-3 text-sm">
      <p className="font-medium">{sweep.ruleBody ?? `Rule ${sweep.ruleId}`}</p>
      <p className="text-xs text-neutral-500">
        {sweep.status} · judged {sweep.judged}/{sweep.total ?? '?'} · {sweep.proposed} proposed
      </p>
      {cd && <p className="text-xs">{cd}</p>}
      <ul className="space-y-1">
        {sweep.proposals.map((p) => {
          const done = !!p.appliedAt;
          const label = p.text ?? p.questionId;
          return (
            <li key={p.questionId} className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={`Keep ${label}`}
                disabled={done}
                checked={sel.has(p.questionId)}
                onChange={() => toggle(p.questionId)}
              />
              <span className={done ? 'text-neutral-400' : ''}>
                {label}
                {p.reason && <span className="block text-xs text-neutral-500">{p.reason}</span>}
                {done && <span className="block text-xs">Hidden</span>}
                {p.keptAt && !done && <span className="block text-xs">Kept</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <Button size="sm" disabled={sel.size === 0} onClick={keep}>
        Keep selected
      </Button>
    </section>
  );
}

export function AdminSweeps() {
  const [sweeps, setSweeps] = useState<AdminSweep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(() => {
    getSweeps().then(setSweeps, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  return (
    <main className="mx-auto max-w-md space-y-3 p-4 pb-24">
      <AdminNav />
      <h1 className="text-xl font-semibold">Sweeps</h1>
      <p className="text-xs text-neutral-500">Anything not kept within 24 h of the notice is hidden.</p>
      {error && <Notice text={error} />}
      {toast && <Notice text={toast} />}
      {!sweeps ? (
        !error && <p>Loading…</p>
      ) : sweeps.length === 0 ? (
        <p className="text-sm text-neutral-500">No sweeps yet.</p>
      ) : (
        sweeps.map((s) => (
          <SweepCard key={s.id} sweep={s} onKept={(m) => { setToast(m); load(); }} />
        ))
      )}
    </main>
  );
}
