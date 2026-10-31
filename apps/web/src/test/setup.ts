import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // Worker tests run under `@vitest-environment node`, which has no DOM storage.
  if (typeof localStorage !== 'undefined') localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});
