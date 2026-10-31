import { useMemo, useState } from 'react';
import { AdminNav } from './AdminNav';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { requestAction } from '@/lib/adminApi';
import { CategoryRows, Notice, QUEUED_MSG, SelectionBar, byIdMap, errorMessage, useTree } from './CategoryList';

export function AdminTree() {
  const { cats, error, reload } = useTree();
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const byId = useMemo(() => byIdMap(cats ?? []), [cats]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = (cats ?? []).filter((c) => showHidden || !c.hidden);
    if (q) return all.filter((c) => c.name.toLowerCase().includes(q));
    return all.filter((c) => c.depth === 0);
  }, [cats, q, showHidden]);

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  const startSelect = (slug?: string) => {
    setSelecting(true);
    if (slug) setSelected(new Set([slug]));
  };
  const stopSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const unhide = async (slug: string) => {
    try {
      await requestAction('unhide', [slug]);
      setToast(QUEUED_MSG);
    } catch (e) {
      setToast(errorMessage(e));
    }
  };

  if (error) return <main className="mx-auto max-w-md p-4"><Notice text={error} /></main>;
  if (!cats) return <main className="mx-auto max-w-md p-4"><p>Loading…</p></main>;

  return (
    <main className="mx-auto max-w-md space-y-3 p-4 pb-24">
      <AdminNav />
      <h1 className="text-xl font-semibold">Categories</h1>
      <Input type="search" placeholder="Search categories" aria-label="Search categories" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden
        </label>
        {!selecting && (
          <Button size="sm" variant="outline" onClick={() => startSelect()}>
            Select
          </Button>
        )}
      </div>
      {toast && <Notice text={toast} />}
      <CategoryRows
        cats={rows}
        byId={byId}
        selecting={selecting}
        selected={selected}
        onToggle={toggle}
        onLongPress={startSelect}
        showPath={!!q}
        onUnhide={unhide}
      />
      {selecting && (
        <SelectionBar
          selected={(cats ?? []).filter((c) => selected.has(c.slug))}
          byId={byId}
          onCancel={stopSelect}
          onDone={(m) => {
            setToast(m);
            stopSelect();
            reload();
          }}
        />
      )}
    </main>
  );
}
