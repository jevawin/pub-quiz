import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActiveTimer } from './activeTimer';

describe('createActiveTimer', () => {
  let visibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['performance', 'Date', 'setTimeout', 'setInterval'],
    });
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('elapsedMs() returns 0 immediately after start()', () => {
    const timer = createActiveTimer();
    timer.start();
    expect(timer.elapsedMs()).toBe(0);
    timer.destroy();
  });

  it('after 1000ms of fake timer advance while visible+focused, elapsedMs is approximately 1000', () => {
    const timer = createActiveTimer();
    timer.start();
    vi.advanceTimersByTime(1000);
    expect(timer.elapsedMs()).toBe(1000);
    timer.destroy();
  });

  it('pause() freezes the count; subsequent time advance does not increase elapsedMs', () => {
    const timer = createActiveTimer();
    timer.start();
    vi.advanceTimersByTime(500);
    timer.pause();
    const frozen = timer.elapsedMs();
    vi.advanceTimersByTime(1000);
    expect(timer.elapsedMs()).toBe(frozen);
    timer.destroy();
  });

  it('blur event pauses; focus event resumes if still visible', () => {
    const timer = createActiveTimer();
    timer.start();
    vi.advanceTimersByTime(200);

    // Blur pauses
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    const afterBlur = timer.elapsedMs();
    vi.advanceTimersByTime(500);
    expect(timer.elapsedMs()).toBe(afterBlur);

    // Focus resumes (still visible)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(300);
    expect(timer.elapsedMs()).toBe(afterBlur + 300);
    timer.destroy();
  });

  it('visibilitychange to hidden pauses; back to visible resumes', () => {
    const timer = createActiveTimer();
    timer.start();
    vi.advanceTimersByTime(100);

    // Hide
    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    const afterHide = timer.elapsedMs();
    vi.advanceTimersByTime(1000);
    expect(timer.elapsedMs()).toBe(afterHide);

    // Show
    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(400);
    expect(timer.elapsedMs()).toBe(afterHide + 400);
    timer.destroy();
  });

  it('reset() clears accumulated time back to 0', () => {
    const timer = createActiveTimer();
    timer.start();
    vi.advanceTimersByTime(500);
    expect(timer.elapsedMs()).toBeGreaterThan(0);
    timer.reset();
    expect(timer.elapsedMs()).toBe(0);
    timer.destroy();
  });

  it('destroy() removes listeners and pauses', () => {
    const timer = createActiveTimer();
    timer.start();
    vi.advanceTimersByTime(200);
    timer.destroy();
    const afterDestroy = timer.elapsedMs();

    // Further time and events should not change anything
    vi.advanceTimersByTime(500);
    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(timer.elapsedMs()).toBe(afterDestroy);
  });
});
