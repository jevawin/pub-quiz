const KEY = 'pub-quiz:show-facts';

export function readShowFacts(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.sessionStorage.getItem(KEY) !== '0';
  } catch {
    return true;
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
