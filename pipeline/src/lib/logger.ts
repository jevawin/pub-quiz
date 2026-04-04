export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  const output = `${prefix} ${message}${suffix}`;

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}
