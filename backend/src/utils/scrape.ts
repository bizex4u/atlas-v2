import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { logWarn } from './logger.js';

const USER_AGENT =
  'AtlasBot/0.1 (+https://bizex4u.com; market-intelligence research; respectful crawler)';

const lastRequestAt = new Map<string, number>();

function hostKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function respectDelay(url: string) {
  const host = hostKey(url);
  const last = lastRequestAt.get(host) ?? 0;
  const wait = 500 - (Date.now() - last);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt.set(host, Date.now());
}

async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.origin}/robots.txt`;
    await respectDelay(robotsUrl);
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return true; // fail open if robots missing
    const body = await res.text();
    const robots = robotsParser(robotsUrl, body);
    return robots.isAllowed(url, USER_AGENT) !== false;
  } catch {
    return true;
  }
}

function mergeSignals(
  timeoutMs: number,
  outer?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!outer) return timeout;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([outer, timeout]);
  }
  // Fallback when AbortSignal.any is unavailable
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (outer.aborted || timeout.aborted) {
    controller.abort();
    return controller.signal;
  }
  outer.addEventListener('abort', onAbort, { once: true });
  timeout.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

export async function fetchHtml(
  url: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ ok: true; html: string; url: string } | { ok: false; reason: string }> {
  try {
    if (options?.signal?.aborted) {
      return { ok: false, reason: 'aborted' };
    }
    const allowed = await isAllowedByRobots(url);
    if (!allowed) {
      return { ok: false, reason: `robots.txt disallows ${url}` };
    }
    await respectDelay(url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: mergeSignals(options?.timeoutMs ?? 15000, options?.signal),
      redirect: 'follow',
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const html = await res.text();
    return { ok: true, html, url: res.url };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (options?.signal?.aborted) {
      return { ok: false, reason: 'aborted' };
    }
    logWarn('fetchHtml failed', { url, reason });
    return { ok: false, reason };
  }
}

export function extractVisibleText(html: string, maxChars = 12000): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars);
}

export const NEWS_SOURCES = [
  {
    name: 'Economic Times',
    searchUrl: (q: string) =>
      `https://economictimes.indiatimes.com/topic/${encodeURIComponent(q)}`,
  },
  {
    name: 'Moneycontrol',
    searchUrl: (q: string) =>
      `https://www.moneycontrol.com/news/tags/${encodeURIComponent(q.replace(/\s+/g, '-').toLowerCase())}.html`,
  },
  {
    name: 'Business Standard',
    searchUrl: (q: string) =>
      `https://www.business-standard.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    name: 'afaqs',
    searchUrl: (q: string) =>
      `https://www.afaqs.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    name: 'Exchange4media',
    searchUrl: (q: string) =>
      `https://www.exchange4media.com/?s=${encodeURIComponent(q)}`,
  },
  {
    name: 'MediaBrief',
    searchUrl: (q: string) =>
      `https://mediabrief.com/?s=${encodeURIComponent(q)}`,
  },
];

export { USER_AGENT, respectDelay, isAllowedByRobots };
