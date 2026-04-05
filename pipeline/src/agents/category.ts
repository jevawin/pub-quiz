import { createClaudeClient, trackUsage, checkBudget, extractJson, SONNET_INPUT, SONNET_OUTPUT } from '../lib/claude.js';
import type { TokenAccumulator } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { CategoryBatchSchema } from '../lib/schemas.js';
import type { PipelineConfig } from '../lib/config.js';
import { log } from '../lib/logger.js';

export interface AgentResult {
  processed: number;
  failed: number;
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  depth: number;
}

/**
 * Build a text representation of the category tree for the Claude prompt.
 * If total categories <= 50, include the full tree.
 * If total categories > 50, summarize root categories with child counts,
 * then include only the 50 leaf categories with the fewest children.
 */
function buildCategoryContext(categories: CategoryRow[]): string {
  if (categories.length === 0) {
    return 'No existing categories yet. Propose top-level categories under the 12 seed themes: Science, History, Geography, Entertainment, Sports, Art & Literature, Music, Food & Drink, Nature, Technology, Pop Culture, Language.';
  }

  if (categories.length <= 50) {
    // Include full tree
    const lines: string[] = ['Existing category tree:'];
    const roots = categories.filter((c) => c.parent_id === null);
    for (const root of roots) {
      lines.push(`- ${root.name} (slug: ${root.slug}, depth: ${root.depth})`);
      appendChildren(root.id, categories, lines, 1);
    }
    return lines.join('\n');
  }

  // Capped mode: summarize roots + 50 leaf categories with most growth potential
  const lines: string[] = ['Existing category tree (summarized, tree has ' + categories.length + ' total categories):'];

  // Root categories with child counts
  const roots = categories.filter((c) => c.parent_id === null);
  for (const root of roots) {
    const childCount = categories.filter((c) => c.parent_id === root.id).length;
    lines.push(`- ${root.name} (slug: ${root.slug}, ${childCount} direct children)`);
  }

  // Find leaf categories (those with no children)
  const parentIds = new Set(categories.filter((c) => c.parent_id !== null).map((c) => c.parent_id));
  const leaves = categories.filter((c) => !parentIds.has(c.id));

  // Sort leaves by depth ascending (prefer shallower leaves that have more room for growth)
  leaves.sort((a, b) => a.depth - b.depth);

  // Take up to 50 leaves
  const cappedLeaves = leaves.slice(0, 50);

  lines.push('\nLeaf categories (most room for growth):');
  for (const leaf of cappedLeaves) {
    lines.push(`- ${leaf.name} (slug: ${leaf.slug}, depth: ${leaf.depth})`);
  }

  return lines.join('\n');
}

function appendChildren(parentId: string, categories: CategoryRow[], lines: string[], indent: number): void {
  const children = categories.filter((c) => c.parent_id === parentId);
  const prefix = '  '.repeat(indent) + '- ';
  for (const child of children) {
    lines.push(`${prefix}${child.name} (slug: ${child.slug}, depth: ${child.depth})`);
    appendChildren(child.id, categories, lines, indent + 1);
  }
}

export async function runCategoryAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<AgentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  // 1. Fetch all existing categories
  log('info', 'Fetching existing categories');
  const { data: existingCategories, error: fetchError } = await supabase
    .from('categories')
    .select('id, name, slug, parent_id, depth');

  if (fetchError) {
    throw new Error(`Failed to fetch categories: ${fetchError.message}`);
  }

  const categories: CategoryRow[] = existingCategories ?? [];
  log('info', 'Found existing categories', { count: categories.length });

  // 2. Build capped context
  const categoryContext = buildCategoryContext(categories);

  // 3. Call Claude for new subcategory proposals
  const systemPrompt =
    'You are a pub quiz category expert. Your job is to propose new subcategories for a quiz app. ' +
    'Every category must pass the pub test: imagine a quizmaster reading the category name out loud to a room — ' +
    'would people nod and feel they have a shot, or would they groan and reach for their phones? ' +
    'Good categories: Classic Rock, World Capitals, Olympic Sports, James Bond Films. ' +
    'Bad categories: Human Anatomy, Social Media Platforms, Cocktail Mixology, Renaissance Art Techniques. ' +
    'Categories should be specific enough to generate interesting questions but broad enough to have 20+ potential questions that ordinary people might actually know the answers to. ' +
    'Avoid academic, technical, or overly niche topics. Favour fun, sociable knowledge over specialist expertise.';

  const userPrompt =
    `${categoryContext}\n\n` +
    `Please propose exactly ${config.categoryBatchSize} new subcategories. ` +
    'Each must be a child of an existing category. ' +
    'Maximum depth is 3 (0=root, 1=child, 2=grandchild, 3=great-grandchild). Do not propose categories at depth 4 or deeper.\n\n' +
    'Respond with a JSON object matching this schema:\n' +
    '{\n' +
    '  "categories": [\n' +
    '    { "name": "Category Name", "slug": "category-slug", "description": "Brief description", "parent_slug": "parent-category-slug" }\n' +
    '  ]\n' +
    '}';

  log('info', 'Calling Claude for category proposals', { model: config.claudeModelGeneration, batchSize: config.categoryBatchSize });

  const response = await claude.messages.create({
    model: config.claudeModelGeneration,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // 4. Track tokens
  trackUsage(response, tokenAccumulator, SONNET_INPUT, SONNET_OUTPUT);
  log('info', 'Token usage tracked', {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cost_so_far: tokenAccumulator.estimated_cost_usd,
  });

  // 5. Check budget
  checkBudget(tokenAccumulator, config.budgetCapUsd);

  // 6. Parse and validate response
  const textContent = response.content.find((block) => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claude response did not contain text content');
  }

  const parsed = JSON.parse(extractJson(textContent.text));
  const batch = CategoryBatchSchema.parse(parsed);

  log('info', 'Parsed category proposals', { count: batch.categories.length });

  // 7. Process each proposed category with per-item error handling
  let processed = 0;
  let failed = 0;
  const existingSlugs = new Set(categories.map((c) => c.slug));

  for (const proposal of batch.categories) {
    try {
      // Check for duplicate slug
      if (existingSlugs.has(proposal.slug)) {
        log('warn', 'Skipping duplicate category slug', { slug: proposal.slug });
        failed++;
        continue;
      }

      // Look up parent
      const parent = categories.find((c) => c.slug === proposal.parent_slug);
      if (!parent) {
        log('warn', 'Skipping category with unknown parent_slug', {
          slug: proposal.slug,
          parent_slug: proposal.parent_slug,
        });
        failed++;
        continue;
      }

      // Enforce max depth of 3
      const newDepth = parent.depth + 1;
      if (newDepth > 3) {
        log('warn', 'Skipping category exceeding max depth', {
          slug: proposal.slug,
          parent_slug: proposal.parent_slug,
          would_be_depth: newDepth,
        });
        failed++;
        continue;
      }

      // Insert into Supabase
      const { data: inserted, error: insertError } = await supabase
        .from('categories')
        .insert({
          name: proposal.name,
          slug: proposal.slug,
          parent_id: parent.id,
          depth: newDepth,
          description: proposal.description,
          created_by: 'pipeline',
        })
        .select('id')
        .single();

      if (insertError) {
        log('error', 'Failed to insert category', {
          slug: proposal.slug,
          error: insertError.message,
        });
        failed++;
        continue;
      }

      existingSlugs.add(proposal.slug);
      log('info', 'Inserted category', { slug: proposal.slug, id: inserted?.id, depth: newDepth });
      processed++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log('error', 'Per-item error processing category', {
        slug: proposal.slug,
        error: errorMessage,
      });
      failed++;
    }
  }

  log('info', 'Category Agent complete', { processed, failed });

  // If ALL items failed, throw to the orchestrator
  if (processed === 0 && failed > 0) {
    throw new Error(`Category Agent: all ${failed} categories failed to process`);
  }

  return { processed, failed };
}
