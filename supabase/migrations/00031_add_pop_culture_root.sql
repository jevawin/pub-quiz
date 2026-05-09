-- Phase 999.21 follow-on: add pop-culture as a new ROOT category.
-- Cross-cutting cat, expected to be a cousin tag for many Qs (Marvel, Disney, Aladdin,
-- video-game franchises with mainstream reach, etc). Will be populated during 999.23
-- (cousin / category audit pass).

INSERT INTO categories (slug, name, parent_id)
VALUES ('pop-culture', 'Pop Culture', NULL)
ON CONFLICT (slug) DO NOTHING;
