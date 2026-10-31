/** Minimal Telegram Bot API sender. Plain text (no parse_mode). Success ONLY on HTTP 200 + JSON ok:true. */
export interface TgConfig {
  token: string;
  chatId: string;
  fetch?: typeof fetch;
}

export type TgResult = { ok: true; messageId: number } | { ok: false; error: string };

export async function sendTelegram(tg: TgConfig, text: string): Promise<TgResult> {
  const f = tg.fetch ?? fetch;
  // Never let the token reach a log line: scrub it from anything we report.
  const scrub = (s: string): string => (tg.token ? s.split(tg.token).join('<token>') : s).slice(0, 300);
  try {
    const res = await f(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chatId, text }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const b = body as { ok?: unknown; description?: unknown; result?: { message_id?: unknown } } | null;
    if (res.status !== 200 || b?.ok !== true) {
      return { ok: false, error: scrub(`HTTP ${res.status}${typeof b?.description === 'string' ? `: ${b.description}` : ''}`) };
    }
    const id = b.result?.message_id;
    if (typeof id !== 'number') return { ok: false, error: 'no message_id in reply' };
    return { ok: true, messageId: id };
  } catch (e) {
    return { ok: false, error: scrub(`send failed: ${(e as Error).message}`) };
  }
}
