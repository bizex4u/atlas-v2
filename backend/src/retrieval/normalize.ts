/**
 * URL / metadata normalization for retrieval candidates and Evidence.
 */

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isProbablyArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path === '/' || path === '') return false;
    if (
      /\/(search|topic|tag|tags|category|categories|author|login|signup|privacy|terms)(\/|$)/i.test(
        path,
      )
    ) {
      return false;
    }
    // Section indexes / hub pages (not articles)
    if (
      /-(news|updates|videos|photos|stories)\.html?$/i.test(path) ||
      /\/(news|marketing|advertising|media|latest)\/?$/i.test(path)
    ) {
      return false;
    }
    if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|zip)(\?|$)/i.test(path)) {
      return false;
    }
    const segments = path.split('/').filter(Boolean);
    // Prefer multi-segment article paths or slug with date-like / numeric id
    if (segments.length >= 2) return true;
    if (segments.length === 1) {
      const slug = segments[0];
      // Single-segment hubs like "advertising-news.html" already rejected above
      return slug.length > 40 || /\d{4}/.test(slug) || /article|story|news-/.test(slug);
    }
    return false;
  } catch {
    return false;
  }
}

export function isSearchOrListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.searchParams.has('s') || u.searchParams.has('q')) return true;
    return /\/(search|topic)(\/|$)/i.test(u.pathname);
  } catch {
    return true;
  }
}
