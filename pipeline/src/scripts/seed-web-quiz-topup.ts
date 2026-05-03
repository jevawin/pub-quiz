/**
 * One-off migration: seed additional subcategories for the Phase 2.2 web quiz
 * and tidy up existing Science categories.
 *
 * Actions:
 *  1. Move all questions from "Space and Astronomy" into "The Solar System"
 *     (they overlap to the point of duplication). Delete the now-empty subcat.
 *  2. Delete "Chemistry Basics" (and its 5 questions — cascade) because none
 *     of the questions have a better home and the tone is too academic for
 *     the pub quiz format.
 *  3. Insert 18 new leaf subcategories under Art and Design, Technology,
 *     Gaming, and Science to unblock the Questions Agent's "least-covered
 *     first" selection for the starved roots before the web quiz ships.
 *
 * Idempotent: re-running is safe. Skips any insert whose slug already exists,
 * skips the merge if Space and Astronomy is already gone.
 */

import 'dotenv/config';
import { loadConfig } from '../lib/config.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

const CREATED_BY = 'manual-seed-web-quiz-topup';

interface NewSubcat {
  name: string;
  slug: string;
  description: string;
}

const NEW_SUBCATS: Record<string, NewSubcat[]> = {
  'Art and Design': [
    { name: 'Famous Artists', slug: 'famous-artists', description: 'Household-name painters and sculptors — Picasso, Van Gogh, Warhol, Frida Kahlo, Banksy.' },
    { name: 'Iconic Architecture', slug: 'iconic-architecture', description: 'Recognisable buildings and structures — Eiffel Tower, Sydney Opera House, Taj Mahal, Burj Khalifa.' },
    { name: 'Famous Works of Art', slug: 'famous-works-of-art', description: 'Individual iconic artworks across forms — sculptures, installations, statues, Venus de Milo, The Thinker, David.' },
    { name: 'Design Icons', slug: 'design-icons', description: 'Everyday design classics everyone recognises — London Underground map, Coca-Cola bottle, VW Beetle, iPhone, Eames chair.' },
    { name: 'Museums and Galleries', slug: 'museums-and-galleries', description: 'Famous museums and galleries, what they hold, and where they are — Louvre, MoMA, Tate, Uffizi, Rijksmuseum.' },
  ],
  Technology: [
    { name: 'Tech Company Founders', slug: 'tech-company-founders', description: 'Founders and early history of household tech companies — Apple, Microsoft, Google, Amazon, Meta, Tesla.' },
    { name: 'The Internet and the Web', slug: 'the-internet-and-the-web', description: 'Origins and milestones of the internet — Tim Berners-Lee, first email, the dot-com era, HTTP, WWW.' },
    { name: 'Iconic Gadgets', slug: 'iconic-gadgets', description: 'Household gadgets of the last 50 years — Walkman, iPod, GameBoy, BlackBerry, Polaroid, Furby.' },
    { name: 'Social Media History', slug: 'social-media-history', description: 'Origins, launches and milestones of social networks — Facebook, Twitter/X, Instagram, TikTok, MySpace.' },
    { name: 'Space Technology', slug: 'space-technology', description: 'Famous spacecraft, rockets and missions — Apollo, Hubble, Voyager, ISS, SpaceX.' },
  ],
  Gaming: [
    { name: 'Console History', slug: 'console-history', description: 'History of video game consoles — Nintendo, PlayStation, Xbox, Sega, launches, console wars, generations.' },
    { name: 'Classic Arcade Games', slug: 'classic-arcade-games', description: 'Golden-age arcade machines — Pac-Man, Space Invaders, Donkey Kong, Street Fighter, Galaga.' },
    { name: 'Gaming Characters', slug: 'gaming-characters', description: 'Iconic video game protagonists and villains — Mario, Link, Lara Croft, Master Chief, Sonic, Kratos.' },
    { name: 'Esports and Competitive Gaming', slug: 'esports-and-competitive-gaming', description: 'Competitive gaming scene — major tournaments, famous teams and players, League of Legends, CS, Dota.' },
    { name: 'Video Game Adaptations', slug: 'video-game-adaptations', description: 'Video games adapted into films and TV — The Last of Us, Super Mario Bros. Movie, Sonic films, Fallout, Arcane.' },
  ],
  Science: [
    { name: 'Famous Scientists', slug: 'famous-scientists', description: 'Household-name scientists and their work — Einstein, Newton, Curie, Darwin, Hawking, Tesla.' },
    { name: 'Inventions and Discoveries', slug: 'inventions-and-discoveries', description: 'Who invented or discovered what, and when — penicillin, telephone, X-rays, electricity, DNA structure.' },
    { name: 'Weather and Natural Phenomena', slug: 'weather-and-natural-phenomena', description: 'Weather, climate records and natural phenomena — hurricanes, tornadoes, aurora, biggest recorded storms.' },
  ],
};

async function main(): Promise<void> {
  const config = loadConfig();
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  // -- 1. Load all categories once
  const { data: cats, error: catErr } = await supabase.from('categories').select('id,name,slug,parent_id,depth');
  if (catErr || !cats) throw new Error('Failed to load categories: ' + catErr?.message);

  const byName = new Map(cats.map((c) => [c.name, c]));
  const bySlug = new Map(cats.map((c) => [c.slug, c]));

  // -- 2. Merge "Space and Astronomy" into "The Solar System"
  // Phase 999.8 Plan 05 dropped questions.category_id, so per-question category
  // membership is now in question_categories. This merge has already run on prod;
  // re-running would need to UPDATE question_categories instead of questions.
  const spaceCat = byName.get('Space and Astronomy');
  const solarCat = byName.get('The Solar System');
  if (spaceCat && solarCat) {
    const { data: moved, error: moveErr } = await supabase
      .from('question_categories')
      .update({ category_id: solarCat.id })
      .eq('category_id', spaceCat.id)
      .select('question_id');
    if (moveErr) throw new Error('Failed to move Space and Astronomy questions: ' + moveErr.message);
    log('info', 'Moved questions: Space and Astronomy → The Solar System', { count: moved?.length ?? 0 });

    const { error: delErr } = await supabase.from('categories').delete().eq('id', spaceCat.id);
    if (delErr) throw new Error('Failed to delete Space and Astronomy category: ' + delErr.message);
    log('info', 'Deleted category: Space and Astronomy');
  } else if (!spaceCat) {
    log('info', 'Skip merge: Space and Astronomy already gone');
  } else {
    throw new Error('The Solar System category missing — cannot merge');
  }

  // -- 3. Delete "Chemistry Basics" and cascade its questions
  const chemCat = byName.get('Chemistry Basics');
  if (chemCat) {
    const { count: qCount } = await supabase
      .from('question_categories')
      .select('question_id', { count: 'exact', head: true })
      .eq('category_id', chemCat.id);
    const { error: delErr } = await supabase.from('categories').delete().eq('id', chemCat.id);
    if (delErr) throw new Error('Failed to delete Chemistry Basics: ' + delErr.message);
    log('info', 'Deleted category: Chemistry Basics (cascaded questions)', { questions_deleted: qCount ?? 0 });
  } else {
    log('info', 'Skip delete: Chemistry Basics already gone');
  }

  // -- 4. Insert new subcats, skipping duplicates by slug
  let inserted = 0;
  let skipped = 0;
  for (const [rootName, subs] of Object.entries(NEW_SUBCATS)) {
    const root = byName.get(rootName);
    if (!root) throw new Error(`Root category not found: ${rootName}`);
    if (root.depth !== 0 || root.parent_id !== null) {
      throw new Error(`Expected ${rootName} to be a root category`);
    }

    for (const sub of subs) {
      if (bySlug.has(sub.slug) || byName.has(sub.name)) {
        log('info', 'Skip subcat (already exists)', { slug: sub.slug });
        skipped++;
        continue;
      }
      const { error: insErr } = await supabase.from('categories').insert({
        name: sub.name,
        slug: sub.slug,
        parent_id: root.id,
        depth: 1,
        description: sub.description,
        created_by: CREATED_BY,
      });
      if (insErr) throw new Error(`Failed to insert ${sub.slug}: ${insErr.message}`);
      log('info', 'Inserted subcat', { root: rootName, name: sub.name });
      inserted++;
    }
  }

  // -- 5. Summary
  log('info', 'Migration complete', { inserted, skipped });

  // -- 6. Post-state summary per root
  // Phase 999.8 Plan 05: questions.category_id and questions.difficulty are gone.
  // Use the counts_by_root_category RPC, which is now backed by question_categories
  // with score-band bucketing (easy/normal/hard derived from effective score).
  const { data: rows } = await supabase.rpc('counts_by_root_category');
  if (!rows) return;

  const summary: Record<string, { easy: number; normal: number; hard: number; total: number }> = {};
  for (const r of rows as Array<{ root_slug: string; difficulty: string; question_count: number }>) {
    const bucket = (summary[r.root_slug] ||= { easy: 0, normal: 0, hard: 0, total: 0 });
    if (r.difficulty === 'easy' || r.difficulty === 'normal' || r.difficulty === 'hard') {
      bucket[r.difficulty] = r.question_count;
      bucket.total += r.question_count;
    }
  }

  console.log('\nPUBLISHED QUESTIONS BY ROOT (post-migration, pre-pipeline-run):');
  console.log('  ' + 'root'.padEnd(24) + 'easy  norm  hard  total');
  Object.entries(summary)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([k, v]) => {
      console.log(
        '  ' +
          k.padEnd(24) +
          String(v.easy).padStart(4) +
          '  ' +
          String(v.normal).padStart(4) +
          '  ' +
          String(v.hard).padStart(4) +
          '  ' +
          String(v.total).padStart(5),
      );
    });
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
