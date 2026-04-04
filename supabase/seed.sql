-- Seed data: 12 root-level categories for the Pub Quiz pipeline.
-- These are the starting points for the Category Agent to discover subcategories.

INSERT INTO categories (name, slug, parent_id, depth, description, created_by) VALUES
  ('Science', 'science', NULL, 0, 'Natural sciences including physics, chemistry, biology, and earth sciences', 'seed'),
  ('History', 'history', NULL, 0, 'World history from ancient civilisations to modern events', 'seed'),
  ('Geography', 'geography', NULL, 0, 'Countries, capitals, landmarks, and physical geography', 'seed'),
  ('Movies and TV', 'movies-and-tv', NULL, 0, 'Film, television series, actors, directors, and awards', 'seed'),
  ('Music', 'music', NULL, 0, 'Artists, albums, genres, instruments, and music history', 'seed'),
  ('Gaming', 'gaming', NULL, 0, 'Video games, board games, tabletop RPGs, and esports', 'seed'),
  ('Sports', 'sports', NULL, 0, 'Professional and amateur sports, athletes, records, and tournaments', 'seed'),
  ('Food and Drink', 'food-and-drink', NULL, 0, 'Cuisine, ingredients, beverages, cooking techniques, and food culture', 'seed'),
  ('Literature', 'literature', NULL, 0, 'Books, authors, poetry, literary movements, and classic works', 'seed'),
  ('Art and Design', 'art-and-design', NULL, 0, 'Visual arts, architecture, graphic design, and art movements', 'seed'),
  ('Technology', 'technology', NULL, 0, 'Computing, internet, inventions, engineering, and tech companies', 'seed'),
  ('Nature and Animals', 'nature-and-animals', NULL, 0, 'Wildlife, ecosystems, conservation, and animal behaviour', 'seed');
