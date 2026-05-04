-- Force PostgREST to reload its schema cache so the new RPC signatures
-- from 00027 (random_published_questions, random_general_knowledge_questions,
-- counts_by_category_difficulty) become callable. Without this, PostgREST
-- can hold the old signatures in its in-memory cache for an indeterminate
-- time after a CREATE OR REPLACE FUNCTION migration.
NOTIFY pgrst, 'reload schema';
