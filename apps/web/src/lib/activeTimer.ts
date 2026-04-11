export function createActiveTimer() {
  let startedAt: number | null = null;
  let accumulated = 0;

  const isActive = () =>
    document.visibilityState === 'visible' && document.hasFocus();

  const start = () => {
    if (startedAt !== null) return;
    if (!isActive()) return;
    startedAt = performance.now();
  };

  const pause = () => {
    if (startedAt === null) return;
    accumulated += performance.now() - startedAt;
    startedAt = null;
  };

  const reset = () => {
    accumulated = 0;
    startedAt = isActive() ? performance.now() : null;
  };

  const elapsedMs = () => {
    const live = startedAt !== null ? performance.now() - startedAt : 0;
    return Math.round(accumulated + live);
  };

  const onVisibility = () => (isActive() ? start() : pause());
  const onFocus = () => (isActive() ? start() : pause());
  const onBlur = () => pause();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);

  const destroy = () => {
    pause();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
  };

  return { start, pause, reset, elapsedMs, destroy };
}
