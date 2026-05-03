#!/usr/bin/env node
/**
 * One-off investigation script for quick task 260426-ow2.
 *
 * OBSOLETE: this script compared the legacy questions.category_id column against
 * the question_categories join table to detect a sport category leak. Phase 999.8
 * Plan 05 dropped questions.category_id, so the legacy side of the comparison no
 * longer exists. The fix shipped in migration 00025 (now superseded by 00027)
 * resolved the leak, and the column drop in 00026 removes the source of the
 * disagreement entirely.
 *
 * Kept as a placeholder to preserve the historical filename. Do not re-run.
 */
function main(): void {
  console.log(
    'investigate-sport-leak: OBSOLETE — questions.category_id was dropped in migration 00026 (Phase 999.8 Plan 05). Nothing to investigate.',
  );
}

main();
