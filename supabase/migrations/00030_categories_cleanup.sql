-- Phase 999.21: Categories cleanup.
-- 1. Merge 5 confirmed dup pairs (rename/keep + reassign Qs to keeper).
-- 2. Merge international-cuisine into world-cuisine (semantic dup).
-- 3. Re-parent mexican-cuisine flat under food-and-drink (consistent w/ siblings).
-- 4. Add 30 new categories across all tiers (3 new roots, 27 sub-cats) for the
--    chain-tagging vision (999.22). Empty until backfill assigns Qs.
--
-- All Q reassignments use INSERT ... ON CONFLICT DO NOTHING then DELETE source rows
-- so that Qs already tagged with both old + new cats don't violate PK.

BEGIN;

-- Defer trigger so multi-step reassignment doesn't transiently break invariants.
SET CONSTRAINTS ALL DEFERRED;

-- ============================================================================
-- 1. Reassign Qs from drop-cats to keeper-cats, then delete drop-cats.
-- ============================================================================

-- Helper pattern (repeated): copy rows to keeper (skip dups), delete from drop, drop cat.

-- 1.1 the-sixties → the-1960s
INSERT INTO question_categories (question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at)
SELECT qc.question_id, k.id, qc.estimate_score, qc.observed_score, qc.observed_n, qc.created_at, qc.updated_at
FROM question_categories qc
JOIN categories d ON d.id = qc.category_id AND d.slug = 'the-sixties'
JOIN categories k ON k.slug = 'the-1960s'
ON CONFLICT (question_id, category_id) DO NOTHING;
DELETE FROM question_categories WHERE category_id = (SELECT id FROM categories WHERE slug = 'the-sixties');
DELETE FROM categories WHERE slug = 'the-sixties';

-- 1.2 formula-one → formula-one-racing
INSERT INTO question_categories (question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at)
SELECT qc.question_id, k.id, qc.estimate_score, qc.observed_score, qc.observed_n, qc.created_at, qc.updated_at
FROM question_categories qc
JOIN categories d ON d.id = qc.category_id AND d.slug = 'formula-one'
JOIN categories k ON k.slug = 'formula-one-racing'
ON CONFLICT (question_id, category_id) DO NOTHING;
DELETE FROM question_categories WHERE category_id = (SELECT id FROM categories WHERE slug = 'formula-one');
DELETE FROM categories WHERE slug = 'formula-one';

-- 1.3 classic-westerns → classic-western-films
INSERT INTO question_categories (question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at)
SELECT qc.question_id, k.id, qc.estimate_score, qc.observed_score, qc.observed_n, qc.created_at, qc.updated_at
FROM question_categories qc
JOIN categories d ON d.id = qc.category_id AND d.slug = 'classic-westerns'
JOIN categories k ON k.slug = 'classic-western-films'
ON CONFLICT (question_id, category_id) DO NOTHING;
DELETE FROM question_categories WHERE category_id = (SELECT id FROM categories WHERE slug = 'classic-westerns');
DELETE FROM categories WHERE slug = 'classic-westerns';

-- 1.4 italian-food → italian-cuisine
INSERT INTO question_categories (question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at)
SELECT qc.question_id, k.id, qc.estimate_score, qc.observed_score, qc.observed_n, qc.created_at, qc.updated_at
FROM question_categories qc
JOIN categories d ON d.id = qc.category_id AND d.slug = 'italian-food'
JOIN categories k ON k.slug = 'italian-cuisine'
ON CONFLICT (question_id, category_id) DO NOTHING;
DELETE FROM question_categories WHERE category_id = (SELECT id FROM categories WHERE slug = 'italian-food');
DELETE FROM categories WHERE slug = 'italian-food';

-- 1.5 mexican-food → mexican-cuisine
INSERT INTO question_categories (question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at)
SELECT qc.question_id, k.id, qc.estimate_score, qc.observed_score, qc.observed_n, qc.created_at, qc.updated_at
FROM question_categories qc
JOIN categories d ON d.id = qc.category_id AND d.slug = 'mexican-food'
JOIN categories k ON k.slug = 'mexican-cuisine'
ON CONFLICT (question_id, category_id) DO NOTHING;
DELETE FROM question_categories WHERE category_id = (SELECT id FROM categories WHERE slug = 'mexican-food');
DELETE FROM categories WHERE slug = 'mexican-food';

-- 1.6 international-cuisine → world-cuisine (semantic dup)
INSERT INTO question_categories (question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at)
SELECT qc.question_id, k.id, qc.estimate_score, qc.observed_score, qc.observed_n, qc.created_at, qc.updated_at
FROM question_categories qc
JOIN categories d ON d.id = qc.category_id AND d.slug = 'international-cuisine'
JOIN categories k ON k.slug = 'world-cuisine'
ON CONFLICT (question_id, category_id) DO NOTHING;
DELETE FROM question_categories WHERE category_id = (SELECT id FROM categories WHERE slug = 'international-cuisine');
DELETE FROM categories WHERE slug = 'international-cuisine';

-- ============================================================================
-- 2. Re-parent mexican-cuisine to flat under food-and-drink (was world-cuisine).
--    Consistent with french-cuisine, indian-cuisine, italian-cuisine, mediterranean-cuisine siblings.
-- ============================================================================

UPDATE categories
SET parent_id = (SELECT id FROM categories WHERE slug = 'food-and-drink')
WHERE slug = 'mexican-cuisine';

-- ============================================================================
-- 3. Add 30 new categories.
--    3 new ROOTs: politics, religion-and-mythology, language-and-words
--    27 new sub-cats across existing roots.
-- ============================================================================

-- 3.1 New ROOTs
INSERT INTO categories (slug, name, parent_id) VALUES
  ('politics',                'Politics',                NULL),
  ('religion-and-mythology',  'Religion and Mythology',  NULL),
  ('language-and-words',      'Language and Words',      NULL)
ON CONFLICT (slug) DO NOTHING;

-- 3.2 Sub-cats — TIER 1
INSERT INTO categories (slug, name, parent_id)
SELECT v.slug, v.name, p.id
FROM (VALUES
  ('classical-music',         'Classical Music',         'music'),
  ('mathematics',             'Mathematics',             'science'),
  ('golf',                    'Golf',                    'sports'),
  ('boxing',                  'Boxing',                  'sports'),
  ('the-1970s',               'The 1970s',               'history'),
  ('the-1990s',               'The 1990s',               'history')
) AS v(slug, name, parent_slug)
JOIN categories p ON p.slug = v.parent_slug
ON CONFLICT (slug) DO NOTHING;

-- 3.3 Sub-cats — TIER 2
INSERT INTO categories (slug, name, parent_id)
SELECT v.slug, v.name, p.id
FROM (VALUES
  ('eurovision',                  'Eurovision',                    'music'),
  ('soundtracks-and-film-music',  'Soundtracks and Film Music',    'music'),
  ('north-american-geography',    'North American Geography',      'geography'),
  ('oceans-and-seas',             'Oceans and Seas',               'geography'),
  ('british-cuisine',             'British Cuisine',               'food-and-drink'),
  ('cocktails',                   'Cocktails',                     'wine-and-spirits'),
  ('poetry',                      'Poetry',                        'literature'),
  ('card-games',                  'Card Games',                    'gaming'),
  ('winter-sports',               'Winter Sports',                 'sports'),
  ('athletics',                   'Athletics',                     'sports')
) AS v(slug, name, parent_slug)
JOIN categories p ON p.slug = v.parent_slug
ON CONFLICT (slug) DO NOTHING;

-- 3.4 Sub-cats — TIER 3
INSERT INTO categories (slug, name, parent_id)
SELECT v.slug, v.name, p.id
FROM (VALUES
  ('chemistry',               'Chemistry',                'science'),
  ('physics',                 'Physics',                  'science'),
  ('mobile-tech',             'Mobile Tech',              'technology'),
  ('ai-and-machine-learning', 'AI and Machine Learning',  'technology'),
  ('british-sitcoms',         'British Sitcoms',          'movies-and-tv'),
  ('reality-tv',              'Reality TV',               'movies-and-tv'),
  ('plants-and-trees',        'Plants and Trees',         'nature-and-animals'),
  ('insects',                 'Insects',                  'nature-and-animals'),
  ('industrial-revolution',   'Industrial Revolution',    'history'),
  ('ancient-greece-history',  'Ancient Greece History',   'history'),
  ('rivers-and-mountains',    'Rivers and Mountains',     'geography')
) AS v(slug, name, parent_slug)
JOIN categories p ON p.slug = v.parent_slug
ON CONFLICT (slug) DO NOTHING;

COMMIT;
