import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Flag, Merge, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthError, addFlag, getTree, requestAction, type AdminCategory } from '@/lib/adminApi';

export const SIGN_IN_MSG = 'Not signed in — open /admin again';
export const QUEUED_MSG = 'Queued — applies within 5 min';
/** A single-question unhide runs at once (no queue). */
export const UNHIDDEN_MSG = 'Unhidden';

/** A dropped or merged category cannot be unhidden: its questions/children moved, only Undo restores them. */
export function undoOnlyKind(hiddenReason: string | null): 'drop' | 'merge' | null {
  return hiddenReason === 'dropped' ? 'drop' : hiddenReason === 'merged' ? 'merge' : null;
}

export function UndoHint({ kind }: { kind: 'drop' | 'merge' }) {
  return <span className="text-xs text-neutral-500">Undo the {kind} in Recent changes</span>;
}

export function errorMessage(e: unknown): string {
  if (e instanceof AuthError) return SIGN_IN_MSG;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function useTree() {
  const [cats, setCats] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    getTree().then(setCats, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(reload, [reload]);
  return { cats, error, reload };
}

export function byIdMap(cats: AdminCategory[]) {
  return new Map(cats.map((c) => [c.id, c]));
}

/** Ancestors from the root down to (not including) `c`. */
export function ancestors(c: AdminCategory, byId: Map<string, AdminCategory>): AdminCategory[] {
  const out: AdminCategory[] = [];
  let p = c.parentId ? byId.get(c.parentId) : undefined;
  for (let i = 0; p && i < 20; i++) {
    out.unshift(p);
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return out;
}

/** Root, general-knowledge (and its subtree) and protected categories can't be merged or dropped. */
export function canRestructure(c: AdminCategory, byId: Map<string, AdminCategory>): boolean {
  if (c.depth === 0 || c.protected || c.slug === 'general-knowledge') return false;
  return !ancestors(c, byId).some((a) => a.slug === 'general-knowledge');
}

export function Notice({ text }: { text: string }) {
  return (
    <p role="status" className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-800">
      {text}
    </p>
  );
}

interface RowsProps {
  cats: AdminCategory[];
  byId: Map<string, AdminCategory>;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (slug: string) => void;
  onLongPress: (slug: string) => void;
  showPath?: boolean;
  onUnhide: (slug: string) => void;
}

export function CategoryRows({ cats, byId, selecting, selected, onToggle, onLongPress, showPath, onUnhide }: RowsProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  if (cats.length === 0) return <p className="text-sm text-neutral-500">No categories.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {cats.map((c) => {
        const path = showPath ? ancestors(c, byId).map((a) => a.name).join(' › ') : '';
        return (
          <li
            key={c.id}
            className={`flex items-center gap-3 p-3 ${c.hidden ? 'text-neutral-400' : ''}`}
            onPointerDown={() => {
              if (!selecting) timer.current = setTimeout(() => onLongPress(c.slug), 500);
            }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
          >
            {selecting && (
              <input
                type="checkbox"
                className="h-5 w-5"
                aria-label={`Select ${c.name}`}
                checked={selected.has(c.slug)}
                onChange={() => onToggle(c.slug)}
              />
            )}
            <div className="min-w-0 flex-1">
              {path && <div className="truncate text-xs text-neutral-500">{path}</div>}
              <div className="truncate font-medium">
                {c.name}
                {c.flagged && <span className="ml-2 text-xs text-amber-600">flagged</span>}
              </div>
              {c.hidden && <div className="text-xs">Hidden{c.hiddenReason ? `: ${c.hiddenReason}` : ''}</div>}
            </div>
            <span className="text-sm tabular-nums" aria-label={`${c.count} questions`}>
              {c.count}
            </span>
            {c.hidden && !selecting && (undoOnlyKind(c.hiddenReason) ? (
              <UndoHint kind={undoOnlyKind(c.hiddenReason)!} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => onUnhide(c.slug)}>
                Unhide
              </Button>
            ))}
            <Link to={`/admin/c/${c.slug}`} aria-label={`Open ${c.name}`} className="p-1">
              <ChevronRight className="h-5 w-5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type Pending = 'merge' | 'drop' | 'flag';

export function confirmText(action: Pending, n: number): string {
  if (action === 'merge') return `Merge ${n} into their parents`;
  if (action === 'drop') return `Drop ${n} categor${n === 1 ? 'y' : 'ies'}; questions with no other home are hidden`;
  return `Flag ${n} categor${n === 1 ? 'y' : 'ies'}`;
}

/** Bottom bar + confirm dialog for the selected categories. */
export function SelectionBar({
  selected,
  byId,
  onDone,
  onCancel,
}: {
  selected: AdminCategory[];
  byId: Map<string, AdminCategory>;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = selected.length;
  const structural = n > 0 && selected.every((c) => canRestructure(c, byId));
  const slugs = selected.map((c) => c.slug);

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      if (pending === 'flag') {
        for (const s of slugs) await addFlag(s);
        onDone(`Flagged ${n}`);
      } else {
        await requestAction(pending, slugs);
        onDone(QUEUED_MSG);
      }
      setPending(null);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const btn = 'gap-1';
  const label = 'hidden min-[360px]:inline';
  return (
    <>
      {pending && (
        <div role="dialog" aria-label="Confirm" className="fixed inset-x-0 bottom-16 z-20 mx-auto max-w-md rounded-md border bg-background p-4 shadow-lg">
          <p className="mb-3">{confirmText(pending, n)}</p>
          {err && <p role="alert" className="mb-2 text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy}>
              Confirm
            </Button>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t bg-background p-3">
        <span className="mr-auto text-sm">{n} selected</span>
        <Button size="sm" variant="outline" className={btn} aria-label="Merge" disabled={!structural} onClick={() => setPending('merge')}>
          <Merge className="h-4 w-4" />
          <span className={label}>Merge</span>
        </Button>
        <Button size="sm" variant="outline" className={btn} aria-label="Drop" disabled={!structural} onClick={() => setPending('drop')}>
          <Trash2 className="h-4 w-4" />
          <span className={label}>Drop</span>
        </Button>
        <Button size="sm" variant="outline" className={btn} aria-label="Flag" disabled={n === 0} onClick={() => setPending('flag')}>
          <Flag className="h-4 w-4" />
          <span className={label}>Flag</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Done
        </Button>
      </div>
    </>
  );
}
