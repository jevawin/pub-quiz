-- Owner "bad category" flags: categories the owner never wants (re)created, e.g. Breakfast Foods.
-- Read by the weekly taxonomy review: flagged names go into the assess prompt as bad examples, and the
-- validator rejects any `create` whose normalised name or slug matches one (reason "recreates a flagged
-- category"). `norm` is computed in code (src/lib/taxonomy/flags.ts normCategoryName), not in SQL.
-- Additive only: no existing rows are modified.

BEGIN;

CREATE TABLE IF NOT EXISTS category_flags (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  norm text NOT NULL UNIQUE,
  category_id uuid NULL REFERENCES categories(id) ON DELETE SET NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Internal table: service role only, like category_aliases / category_changes.
ALTER TABLE category_flags ENABLE ROW LEVEL SECURITY;

INSERT INTO category_flags (name, norm, category_id, note)
VALUES
  ('Breakfast Foods', 'breakfast-food', (SELECT id FROM categories WHERE slug = 'breakfast-foods'), 'owner: dull everyday meals (2026-10-30)'),
  ('Full English Breakfast', 'full-english-breakfast', (SELECT id FROM categories WHERE slug = 'full-english-breakfast'), 'owner: dull everyday meals (2026-10-30)')
ON CONFLICT (norm) DO NOTHING;

COMMIT;
