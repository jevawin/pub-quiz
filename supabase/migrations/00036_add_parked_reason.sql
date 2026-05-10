-- 260510-prk: Parking lane for orphan-category questions.
-- Adds nullable parked_reason text column to questions. Convention:
-- status='parked' + parked_reason='awaiting category: <slug>' for Qs whose
-- correct category doesn't yet exist in the tree (deferred to 260510-fas-altmed).
-- Live-quiz RPCs filter WHERE status='published', so parked rows fall out of play
-- without deletion. status remains plain text — no enum migration.
--
-- Parks 3 outliers from 999.23 mistag review:
--   8843ae93… (Japanese shiatsu)        → awaiting category: alternative-medicine
--   a56a93d2… (Inditex/Zara HQ)         → awaiting category: fashion-and-clothing
--   ce1c631c… (Scotsman/kilt)           → awaiting category: fashion-and-clothing

BEGIN;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS parked_reason text;

-- Widen status CHECK to allow 'parked' (plain text, no enum). See 260510-prk in ROADMAP §C1.
ALTER TABLE questions DROP CONSTRAINT questions_status_check;
ALTER TABLE questions ADD CONSTRAINT questions_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text, 'published'::text, 'parked'::text]));

-- Optimistic guards: only park rows currently published. If pre-state differs
-- (already parked / rejected), the UPDATE no-ops and migration still succeeds.

UPDATE questions
SET status = 'parked', parked_reason = 'awaiting category: alternative-medicine'
WHERE id = '8843ae93-a391-4c54-a264-9bcfcdd44ecb' AND status = 'published';

UPDATE questions
SET status = 'parked', parked_reason = 'awaiting category: fashion-and-clothing'
WHERE id = 'a56a93d2-634c-48f9-bb48-829cc3011f97' AND status = 'published';

UPDATE questions
SET status = 'parked', parked_reason = 'awaiting category: fashion-and-clothing'
WHERE id = 'ce1c631c-f42d-435f-82d5-f225e34f7b8e' AND status = 'published';

COMMIT;
