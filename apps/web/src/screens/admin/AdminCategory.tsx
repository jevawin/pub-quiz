import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminNav } from './AdminNav';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addNote,
  addRule,
  getCategoryQuestions,
  hideQuestion,
  requestAction,
  unhideQuestion,
  type AdminQuestion,
} from '@/lib/adminApi';
import { CategoryRows, Notice, QUEUED_MSG, UNHIDDEN_MSG, SelectionBar, ancestors, byIdMap, errorMessage, useTree } from './CategoryList';

type FormKind = 'hide' | 'rule' | 'note';

const FORM = {
  hide: { label: 'Reason for hiding', submit: 'Hide' },
  rule: { label: 'Rule (what should be excluded?)', submit: 'Save rule' },
  note: { label: 'Note', submit: 'Save note' },
} as const;

function QuestionForm({ kind, q, categoryId, onDone, onCancel }: { kind: FormKind; q?: AdminQuestion; categoryId?: string; onDone: (m: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (categoryId) {
        await addNote('category', categoryId, text.trim());
        onDone('Note saved');
      } else if (!q) {
        return;
      } else if (kind === 'hide') {
        await hideQuestion(q.id, text.trim());
        onDone('Question hidden');
      } else if (kind === 'rule') {
        await addRule(text.trim(), q.id);
        onDone('Rule saved');
      } else {
        await addNote('question', q.id, text.trim());
        onDone('Note saved');
      }
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block text-sm">
        {FORM[kind].label}
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={kind === 'hide' ? 200 : 500} />
      </label>
      {kind === 'rule' && (
        <p className="text-xs text-neutral-500">
          <span>At least 5 characters</span>
          <br />This question is saved as the example.
        </p>
      )}
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || text.trim().length < (kind === 'rule' ? 5 : 1)}>
          {FORM[kind].submit}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function QuestionCard({ q, onChanged }: { q: AdminQuestion; onChanged: (m: string) => void }) {
  const [form, setForm] = useState<FormKind | null>(null);
  const parked = q.status !== 'published';
  const unhide = async () => {
    try {
      await unhideQuestion(q.id);
      onChanged(UNHIDDEN_MSG);
    } catch (e) {
      onChanged(errorMessage(e));
    }
  };
  return (
    <li className={`space-y-1 rounded-md border p-3 ${parked ? 'text-neutral-400' : ''}`}>
      <p>{q.text}</p>
      <p className="font-bold">{q.answer}</p>
      {q.distractors.length > 0 && <p className="text-sm">{q.distractors.join(' · ')}</p>}
      {q.funFact && <p className="text-sm italic">{q.funFact}</p>}
      {form ? (
        <QuestionForm
          kind={form}
          q={q}
          onCancel={() => setForm(null)}
          onDone={(m) => {
            setForm(null);
            onChanged(m);
          }}
        />
      ) : (
        <div className="flex gap-2 pt-1">
          {parked ? (
            <Button size="sm" variant="outline" onClick={unhide}>
              Unhide
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setForm('hide')}>
              Hide
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setForm('rule')}>
            Rule
          </Button>
          <Button size="sm" variant="outline" onClick={() => setForm('note')}>
            Note
          </Button>
        </div>
      )}
    </li>
  );
}

export function AdminCategory() {
  const { slug = '' } = useParams();
  const { cats, error, reload } = useTree();
  const [showHidden, setShowHidden] = useState(false);
  const [questions, setQuestions] = useState<AdminQuestion[] | null>(null);
  const [qError, setQError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [catNote, setCatNote] = useState(false);

  const loadQuestions = useCallback(() => {
    getCategoryQuestions(slug, showHidden).then(setQuestions, (e) => setQError(errorMessage(e)));
  }, [slug, showHidden]);
  useEffect(loadQuestions, [loadQuestions]);

  const byId = useMemo(() => byIdMap(cats ?? []), [cats]);
  const cat = (cats ?? []).find((c) => c.slug === slug);
  const children = (cats ?? []).filter((c) => cat && c.parentId === cat.id && (showHidden || !c.hidden));

  const toggle = (s: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const stopSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const unhideCat = async (s: string) => {
    try {
      await requestAction('unhide', [s]);
      setToast(QUEUED_MSG);
    } catch (e) {
      setToast(errorMessage(e));
    }
  };

  const err = error ?? qError;
  if (err) return <main className="mx-auto max-w-md p-4"><Notice text={err} /></main>;
  if (!cats || !questions) return <main className="mx-auto max-w-md p-4"><p>Loading…</p></main>;
  if (!cat) return <main className="mx-auto max-w-md p-4"><Notice text="Category not found" /></main>;

  return (
    <main className="mx-auto max-w-md space-y-3 p-4 pb-24">
      <AdminNav />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        <Link to="/admin" className="underline">
          All
        </Link>
        {ancestors(cat, byId).map((a) => (
          <span key={a.id}>
            {' › '}
            <Link to={`/admin/c/${a.slug}`} className="underline">
              {a.name}
            </Link>
          </span>
        ))}
        <span>
          {' › '}
          <strong>{cat.name}</strong>
        </span>
      </nav>
      <h1 className="text-xl font-semibold">
        {cat.name} <span className="text-base font-normal text-neutral-500">({cat.count})</span>
      </h1>
      <div className="flex items-center gap-3 text-sm">
        {cat.notes > 0 && <span>{cat.notes} {cat.notes === 1 ? 'note' : 'notes'}</span>}
        {!catNote && (
          <Button size="sm" variant="outline" aria-label="Note on category" onClick={() => setCatNote(true)}>
            Note
          </Button>
        )}
      </div>
      {catNote && (
        <QuestionForm
          kind="note"
          categoryId={cat.id}
          onCancel={() => setCatNote(false)}
          onDone={(m) => {
            setCatNote(false);
            setToast(m);
            reload();
          }}
        />
      )}
      {cat.hidden && <Notice text={`Hidden${cat.hiddenReason ? `: ${cat.hiddenReason}` : ''}`} />}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden
        </label>
        {children.length > 0 && !selecting && (
          <Button size="sm" variant="outline" onClick={() => setSelecting(true)}>
            Select
          </Button>
        )}
      </div>
      {toast && <Notice text={toast} />}
      {children.length > 0 && (
        <CategoryRows
          cats={children}
          byId={byId}
          selecting={selecting}
          selected={selected}
          onToggle={toggle}
          onLongPress={(s) => {
            setSelecting(true);
            setSelected(new Set([s]));
          }}
          onUnhide={unhideCat}
        />
      )}
      <h2 className="pt-2 text-lg font-semibold">Questions</h2>
      {questions.length === 0 ? (
        <p className="text-sm text-neutral-500">No questions.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              onChanged={(m) => {
                setToast(m);
                loadQuestions();
              }}
            />
          ))}
        </ul>
      )}
      {selecting && (
        <SelectionBar
          selected={children.filter((c) => selected.has(c.slug))}
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
