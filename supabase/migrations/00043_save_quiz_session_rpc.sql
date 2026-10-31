-- End-screen feedback: the rating saves on tap, the text on Submit, into ONE row.
-- quiz_sessions stays insert-only for the browser (no UPDATE/SELECT policies);
-- this SECURITY DEFINER upsert is the only edit path. It can only touch rows
-- owned by the caller (session_id = auth.uid()) and only changes
-- overall_rating/feedback_text on an existing row.
-- p_id NULL (rows queued in a browser outbox before this change) = plain insert.
CREATE OR REPLACE FUNCTION save_quiz_session(
  p_id UUID,
  p_category_slug TEXT,
  p_difficulty TEXT,
  p_num_questions INT,
  p_score INT,
  p_overall_rating TEXT,
  p_feedback_text TEXT,
  p_started_at TIMESTAMPTZ
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;

  INSERT INTO quiz_sessions (
    id, session_id, category_slug, difficulty, num_questions, score,
    overall_rating, feedback_text, started_at
  ) VALUES (
    COALESCE(p_id, gen_random_uuid()), auth.uid(), p_category_slug, p_difficulty,
    p_num_questions, p_score, p_overall_rating, p_feedback_text, p_started_at
  )
  ON CONFLICT (id) DO UPDATE
    SET overall_rating = EXCLUDED.overall_rating,
        feedback_text = EXCLUDED.feedback_text
    WHERE quiz_sessions.session_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION save_quiz_session(UUID, TEXT, TEXT, INT, INT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_quiz_session(UUID, TEXT, TEXT, INT, INT, TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;
