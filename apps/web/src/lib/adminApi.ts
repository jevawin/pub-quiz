// Typed wrappers for the Worker admin API (apps/web/worker/api.ts + write.ts).
// Same-origin, behind Cloudflare Access. 401/403 both become AuthError.

export class AuthError extends Error {
  constructor() {
    super('Not signed in — open /admin again');
    this.name = 'AuthError';
  }
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  depth: number;
  count: number;
  hidden: boolean;
  hiddenReason: string | null;
  protected: boolean;
  flagged: boolean;
  notes: number;
}

export interface AdminQuestion {
  id: string;
  text: string;
  answer: string;
  distractors: string[];
  funFact: string | null;
  status: string;
  notes: number;
}

export interface ChangeRun {
  runId: string;
  at: string;
  actions: { action: string; summary: string }[];
  undone: boolean;
}

export interface SweepSummary {
  id: string | number;
  status: string;
  total: number | null;
  judged: number;
  proposed: number;
  executeAfter: string | null;
  createdAt: string;
}

export interface AdminRule {
  id: number;
  body: string;
  exampleQuestionId: string | null;
  active: boolean;
  createdAt: string;
  lastSweep: SweepSummary | null;
}

export interface SweepProposal {
  questionId: string;
  text: string | null;
  answer: string | null;
  reason: string | null;
  keptAt: string | null;
  appliedAt: string | null;
}

export interface AdminSweep extends SweepSummary {
  ruleId: number;
  ruleBody: string | null;
  noticeSentAt: string | null;
  proposals: SweepProposal[];
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (method !== 'GET') {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, init);
  if (res.status === 401 || res.status === 403) throw new AuthError();
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const getTree = () => call<{ categories: AdminCategory[] }>('GET', '/admin/api/tree').then((r) => r.categories);

export const getCategoryQuestions = (slug: string, includeHidden = false) =>
  call<{ questions: AdminQuestion[] }>(
    'GET',
    `/admin/api/categories/${enc(slug)}/questions${includeHidden ? '?include=hidden' : ''}`,
  ).then((r) => r.questions);

export interface HiddenQuestion {
  id: string;
  text: string;
  answer: string;
  parkedReason: string | null;
}
export const getHiddenQuestions = (limit = 200) =>
  call<{ questions: HiddenQuestion[] }>('GET', `/admin/api/questions/hidden?limit=${limit}`).then((r) => r.questions);

export const getChanges = (limit = 50) => call<{ runs: ChangeRun[] }>('GET', `/admin/api/changes?limit=${limit}`).then((r) => r.runs);
export interface AdminRequest {
  id: number | string;
  action: string;
  payload: unknown;
  status: 'queued' | 'running' | 'done' | 'failed' | string;
  result: string | null;
  createdAt: string;
  doneAt: string | null;
}
export const getRequests = (limit = 50) =>
  call<{ requests: AdminRequest[] }>('GET', `/admin/api/requests?limit=${limit}`).then((r) => r.requests);
export const getRules = () => call<{ rules: AdminRule[] }>('GET', '/admin/api/rules').then((r) => r.rules);
export const getSweeps = () => call<{ sweeps: AdminSweep[] }>('GET', '/admin/api/sweeps').then((r) => r.sweeps);

/** Queued: the Pi applies it within ~5 min. */
export const requestAction = (action: 'merge' | 'drop' | 'unhide', slugs: string[]) =>
  call<{ id: string | number }>('POST', '/admin/api/requests', { action, slugs });
export const undoRun = (runId: string) => call<{ id: string | number }>('POST', '/admin/api/undo', { runId });

export const hideQuestion = (id: string, reason: string) =>
  call<{ ok: true; runId: string }>('POST', `/admin/api/questions/${enc(id)}/hide`, { reason });
export const unhideQuestion = (id: string) => call<{ ok: true; runId: string }>('POST', `/admin/api/questions/${enc(id)}/unhide`, {});

export const addFlag = (slug: string) => call<{ ok: true; norm: string }>('POST', '/admin/api/flags', { slug });
export const removeFlag = (slug: string) => call<{ ok: true; removed: number }>('DELETE', `/admin/api/flags/${enc(slug)}`);

export const addNote = (targetType: 'category' | 'question', targetId: string, body: string) =>
  call<{ id: string | number }>('POST', '/admin/api/notes', { targetType, targetId, body });

export const addRule = (body: string, exampleQuestionId?: string) =>
  call<{ id: number }>('POST', '/admin/api/rules', exampleQuestionId ? { body, exampleQuestionId } : { body });
export const setRuleActive = (id: number | string, active: boolean) => call<{ ok: true }>('POST', `/admin/api/rules/${enc(String(id))}`, { active });
export const sweepRule = (id: number | string) => call<{ id: string | number }>('POST', `/admin/api/rules/${enc(String(id))}/sweep`, {});
export const keepProposals = (sweepId: number | string, questionIds: string[]) =>
  call<{ kept: number }>('POST', `/admin/api/sweeps/${enc(String(sweepId))}/keep`, { questionIds });
