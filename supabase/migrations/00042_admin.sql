-- Owner admin page + rule sweep: request queue, notes, quality rules, sweep runs/proposals,
-- the 'dropped' hide reason, new category_changes actions, and two SQL functions that hide/unhide
-- a single question while writing the same category_changes rows the TypeScript engine writes.
-- Additive: no existing rows are modified. Constraints are dropped and re-added (widened only).

BEGIN;

-- Widen categories_hidden_reason_check with 'dropped'.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_hidden_reason_check;
ALTER TABLE categories ADD CONSTRAINT categories_hidden_reason_check
  CHECK (hidden_reason IN ('merged', 'trimmed', 'veto', 'dropped'));

-- Widen category_changes_action_check with drop / hide_question / unhide_question / sweep_drop.
ALTER TABLE category_changes DROP CONSTRAINT IF EXISTS category_changes_action_check;
ALTER TABLE category_changes ADD CONSTRAINT category_changes_action_check
  CHECK (action IN ('merge','hide','unhide','create','rehome','flag_duplicate','protect',
                    'drop','hide_question','unhide_question','sweep_drop'));

CREATE TABLE IF NOT EXISTS admin_requests (
  id bigserial PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('merge','drop','unhide','undo','sweep')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  result text NULL,
  run_id text NULL,
  created_at timestamptz DEFAULT now(),
  done_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id bigserial PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('category','question')),
  target_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_target ON admin_notes(target_type, target_id);

CREATE TABLE IF NOT EXISTS question_rules (
  id bigserial PRIMARY KEY,
  body text NOT NULL CHECK (length(body) BETWEEN 5 AND 500),
  example_question_id uuid NULL REFERENCES questions(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweep_runs (
  id bigserial PRIMARY KEY,
  rule_id bigint NOT NULL REFERENCES question_rules(id),
  status text NOT NULL DEFAULT 'judging' CHECK (status IN ('judging','noticed','applied','cancelled')),
  total int NULL,
  judged int NOT NULL DEFAULT 0,
  proposed int NOT NULL DEFAULT 0,
  notice_sent_at timestamptz NULL,
  tg_message_id bigint NULL,
  execute_after timestamptz NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sweep_proposals (
  sweep_id bigint REFERENCES sweep_runs(id) ON DELETE CASCADE,
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('keep','drop')),
  reason text NULL,
  kept_at timestamptz NULL,
  applied_at timestamptz NULL,
  PRIMARY KEY (sweep_id, question_id)
);

-- Internal tables: service role only, like category_aliases / category_changes.
ALTER TABLE admin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_proposals ENABLE ROW LEVEL SECURITY;

-- Hide one question (park it). No-op if already parked; raises if it does not exist.
CREATE OR REPLACE FUNCTION admin_hide_question(p_question uuid, p_reason text, p_run text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  q questions%ROWTYPE;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'no reason given');
BEGIN
  SELECT * INTO q FROM questions WHERE id = p_question FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_hide_question: question % does not exist', p_question;
  END IF;
  IF q.status = 'parked' THEN
    RETURN;
  END IF;

  INSERT INTO category_changes (run_id, action, payload, prior)
  VALUES (
    p_run,
    'hide_question',
    jsonb_build_object('questionId', p_question, 'reason', v_reason),
    jsonb_build_object('id', q.id, 'status', q.status, 'parked_reason', q.parked_reason)
  );

  UPDATE questions
  SET status = 'parked', parked_reason = 'owner: ' || v_reason
  WHERE id = p_question;
END $$;

-- Restore a question from the newest not-undone hide_question / sweep_drop row for it.
CREATE OR REPLACE FUNCTION admin_unhide_question(p_question uuid, p_run text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  q questions%ROWTYPE;
  src category_changes%ROWTYPE;
BEGIN
  SELECT * INTO q FROM questions WHERE id = p_question FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_unhide_question: question % does not exist', p_question;
  END IF;

  IF q.status <> 'parked' THEN
    RAISE EXCEPTION 'question % is no longer parked (status %); not restoring', p_question, q.status;
  END IF;

  SELECT * INTO src
  FROM category_changes
  WHERE action IN ('hide_question','sweep_drop')
    AND undone_at IS NULL
    AND prior->>'id' = p_question::text
  ORDER BY id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_unhide_question: no undoable hide for question %', p_question;
  END IF;

  INSERT INTO category_changes (run_id, action, payload, prior)
  VALUES (
    p_run,
    'unhide_question',
    jsonb_build_object('questionId', p_question),
    jsonb_build_object('id', q.id, 'status', q.status, 'parked_reason', q.parked_reason)
  );

  UPDATE questions
  SET status = src.prior->>'status',
      parked_reason = src.prior->>'parked_reason'
  WHERE id = p_question;

  UPDATE category_changes SET undone_at = now() WHERE id = src.id;
END $$;

REVOKE EXECUTE ON FUNCTION admin_hide_question(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_unhide_question(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_hide_question(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION admin_unhide_question(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
