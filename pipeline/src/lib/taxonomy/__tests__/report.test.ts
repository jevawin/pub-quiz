import { describe, it, expect } from 'vitest';
import { buildReport } from '../report.js';
import type { ApplySummary } from '../apply.js';

const base = (o: Partial<ApplySummary> = {}): ApplySummary => ({
  merged: 0, hidden: 0, created: [], rehomed: 0, flagged: 0, skippedAlreadyDone: 0, errors: [], ...o,
});

describe('buildReport', () => {
  it('says so when nothing changed', () => {
    expect(buildReport(base(), [], null, 'weekly')).toContain('No category changes this week.');
  });

  it('cleanup mode does not say "this week"', () => {
    const r = buildReport(base(), [], null, 'cleanup');
    expect(r).toContain('No category changes.');
    expect(r).not.toContain('this week');
  });

  it('lists counts, new category NAMES and newly visible categories', () => {
    const r = buildReport(
      base({ merged: 3, hidden: 2, created: ['harry-potter-spells'], rehomed: 7, flagged: 1 }),
      ['Cheeses of the World'],
      42,
      'weekly',
      { names: { 'harry-potter-spells': 'Harry Potter Spells' } },
    );
    expect(r).toContain('Merged: 3');
    expect(r).toContain('Hidden: 2');
    expect(r).toContain('Re-homed: 7');
    expect(r).toContain('Questions added: 42');
    expect(r).toContain('Harry Potter Spells');
    expect(r).toContain('Now visible: Cheeses of the World');
  });

  it('omits the questions-added line when unknown', () => {
    expect(buildReport(base({ merged: 1 }), [], null, 'cleanup')).not.toContain('Questions added');
  });

  it('truncates 60 new names to "+N more" within 3500 chars', () => {
    const created = Array.from({ length: 60 }, (_, i) => `cat-${i}`);
    const names = Object.fromEntries(created.map((s, i) => [s, `A fairly long category name number ${i} for testing`]));
    const vis = Array.from({ length: 80 }, (_, i) => `Visible category with a long name ${i}`);
    const r = buildReport(base({ created }), vis, 5, 'weekly', { names });
    expect(r.length).toBeLessThanOrEqual(3500);
    expect(r).toMatch(/\+\d+ more/);
  });

  it('keeps the list intact when it fits', () => {
    const r = buildReport(base({ created: ['a', 'b'] }), [], null, 'weekly', { names: { a: 'Alpha', b: 'Beta' } });
    expect(r).toContain('Alpha, Beta');
    expect(r).not.toMatch(/more/);
  });

  it('strips control characters from DB-sourced names', () => {
    const r = buildReport(base({ created: ['x'] }), ['Bad\u0007Name\u001b[31m\nline'], null, 'weekly', {
      names: { x: 'Evil\u0000\r\nName\u2028' },
    });
    expect(r).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(r).toContain('EvilName');
  });

  it('reports errors even with no changes, and stays bounded', () => {
    const r = buildReport(base({ errors: Array.from({ length: 500 }, (_, i) => `err ${i} ${'x'.repeat(50)}`) }), [], null, 'cleanup');
    expect(r.length).toBeLessThanOrEqual(3500);
    expect(r).toContain('Errors: 500');
  });
});
