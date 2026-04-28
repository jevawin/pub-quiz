const KEY = 'pub-quiz:show-facts';

export function readShowFacts(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeShowFacts(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // sessionStorage unavailable — silently no-op
  }
}
