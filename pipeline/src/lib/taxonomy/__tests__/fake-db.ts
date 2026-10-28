import type { TypedSupabaseClient } from '../../supabase.js';

type Row = Record<string, unknown>;
type Res = { data: unknown; error: { message: string } | null; count?: number };

export interface FakeDb {
  client: TypedSupabaseClient;
  tables: Record<string, Row[]>;
  /** Writes issued so far (insert/upsert/update/delete). */
  writes: () => number;
  /** After this many further writes, every write fails (simulates a killed process). Null = healthy. */
  killAfter: (n: number | null) => void;
  snapshot: () => string;
  /** Called after every successful write (table, op, running count); may mutate `tables` to inject concurrent writes. */
  onWrite: (fn: ((table: string, op: string, n: number) => void) | null) => void;
  /** Call recorder: every select issued (table, column list, eq-filter columns), in order. */
  selects: { table: string; cols: string; eqs: string[] }[];
}

const PK: Record<string, string[]> = {
  categories: ['id'],
  question_categories: ['question_id', 'category_id'],
  category_aliases: ['old_slug'],
  category_changes: ['id'],
  questions: ['id'],
};

export function makeFakeDb(seed: Record<string, Row[]>): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  for (const k of Object.keys(PK)) tables[k] ??= [];
  let nWrites = 0;
  let budget: number | null = null;
  let nextChangeId = 1;
  let hook: ((table: string, op: string, n: number) => void) | null = null;
  const selects: { table: string; cols: string; eqs: string[] }[] = [];

  const err = (m: string): Res => ({ data: null, error: { message: m } });

  function checkRules(table: string): string | null {
    if (table === 'question_categories') {
      const counts = new Map<unknown, number>();
      for (const r of tables.question_categories) counts.set(r.question_id, (counts.get(r.question_id) ?? 0) + 1);
      for (const [q, n] of counts) if (n > 8) return `Question ${String(q)} cannot have more than 8 categories (got ${n})`;
    }
    if (table === 'categories') {
      const slugs = new Set<unknown>();
      for (const r of tables.categories) {
        if (slugs.has(r.slug)) return `duplicate slug ${String(r.slug)}`;
        slugs.add(r.slug);
        if ((r.depth as number) > 5 || (r.depth as number) < 0) return 'depth check';
        if (r.hidden_reason != null && !['merged', 'trimmed', 'veto'].includes(r.hidden_reason as string)) return 'hidden_reason check';
      }
    }
    return null;
  }

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
    let op: Op = 'select';
    let payload: unknown;
    let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let rng: [number, number] | null = null;
    let wantSingle = false;
    let wantReturn = false;
    let wantHead = false;
    let rec: { table: string; cols: string; eqs: string[] } | null = null;

    const pk = PK[table] ?? ['id'];
    const samePk = (a: Row, b: Row) => pk.every((k) => a[k] === b[k]);

    function execute(): Res {
      const rows = tables[table];
      if (op === 'select') {
        let out = rows.filter((r) => filters.every((f) => f(r)));
        for (const o of [...orders].reverse()) {
          out = [...out].sort((a, b) => {
            const x = a[o.col] as string | number;
            const y = b[o.col] as string | number;
            return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
          });
        }
        if (wantHead) return { data: null, error: null, count: out.length };
        if (rng) out = out.slice(rng[0], rng[1] + 1);
        const copy = out.map((r) => ({ ...r }));
        if (wantSingle) return copy.length === 1 ? { data: copy[0], error: null } : err(`single() got ${copy.length} rows`);
        return { data: copy, error: null };
      }
      // writes
      nWrites++;
      if (budget !== null) {
        if (budget <= 0) return err('simulated crash');
        budget--;
      }
      const backup = rows.map((r) => ({ ...r }));
      const rollback = (m: string): Res => {
        tables[table] = backup;
        return err(m);
      };
      let returned: Row[] = [];
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        for (const raw of list) {
          const row: Row = { ...raw };
          if (table === 'category_changes') {
            row.id = nextChangeId++;
            row.undone_at ??= null;
          }
          const idx = tables[table].findIndex((r) => samePk(r, row));
          if (idx >= 0) {
            if (op === 'insert') return rollback(`duplicate key on ${table}`);
            if (!opts.ignoreDuplicates) tables[table][idx] = { ...tables[table][idx], ...row };
          } else {
            if (table === 'question_categories') {
              if (!tables.questions.some((q) => q.id === row.question_id)) return rollback('fk question');
              if (!tables.categories.some((c) => c.id === row.category_id)) return rollback('fk category');
            }
            tables[table].push(row);
          }
          returned.push(row);
        }
      } else if (op === 'update') {
        for (const r of tables[table]) if (filters.every((f) => f(r))) Object.assign(r, payload as Row);
      } else if (op === 'delete') {
        const dead = tables[table].filter((r) => filters.every((f) => f(r)));
        if (table === 'categories') {
          for (const d of dead) {
            if (tables.question_categories.some((l) => l.category_id === d.id)) return rollback('RESTRICT: category has links');
          }
          for (const d of dead) tables.category_aliases = tables.category_aliases.filter((a) => a.category_id !== d.id);
        }
        tables[table] = tables[table].filter((r) => !dead.includes(r));
      }
      const bad = checkRules(table);
      if (bad) return rollback(bad);
      hook?.(table, op, nWrites);
      if (wantReturn && wantSingle) return { data: returned[0] ? { ...returned[0] } : null, error: null };
      return { data: null, error: null };
    }

    const q = {
      select: (cols?: string, o?: { head?: boolean; count?: string }) => {
        if (op === 'select') {
          rec = { table, cols: cols ?? '*', eqs: [] };
          selects.push(rec);
        }
        if (o?.head) wantHead = true;
        if (op !== 'select') wantReturn = true;
        return q;
      },
      insert: (p: unknown) => {
        op = 'insert';
        payload = p;
        return q;
      },
      upsert: (p: unknown, o?: typeof opts) => {
        op = 'upsert';
        payload = p;
        opts = o ?? {};
        return q;
      },
      update: (p: unknown) => {
        op = 'update';
        payload = p;
        return q;
      },
      delete: () => {
        op = 'delete';
        return q;
      },
      eq: (c: string, v: unknown) => {
        rec?.eqs.push(c);
        filters.push((r) => r[c] === v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[c]));
        return q;
      },
      is: (c: string, v: unknown) => {
        filters.push((r) => (r[c] ?? null) === v);
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        orders.push({ col: c, asc: o?.ascending !== false });
        return q;
      },
      range: (a: number, b: number) => {
        rng = [a, b];
        return q;
      },
      single: () => {
        wantSingle = true;
        return q;
      },
      then: (res: (v: Res) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(execute).then(res, rej),
    };
    return q;
  }

  const canon = () =>
    JSON.stringify(
      Object.fromEntries(
        ['categories', 'question_categories', 'category_aliases'].map((t) => {
          const rows = tables[t].map((r) => {
            const { created_at: _c, updated_at: _u, ...rest } = r as Row;
            void _c;
            void _u;
            const norm = (v: unknown) =>
              typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)
                ? 'UUID'
                : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)
                  ? 'TS'
                  : v;
            return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, norm(v)]).sort(([a], [b]) => ((a as string) < (b as string) ? -1 : 1)));
          });
          rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
          return [t, rows];
        }),
      ),
    );

  return {
    client: { from } as unknown as TypedSupabaseClient,
    tables,
    writes: () => nWrites,
    killAfter: (n) => {
      budget = n;
    },
    snapshot: canon,
    selects,
    onWrite: (fn) => {
      hook = fn;
    },
  };
}
