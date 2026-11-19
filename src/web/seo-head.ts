const CANONICAL_ORIGIN = 'https://myartifact.app';

export interface DocumentSeoOptions {
  title: string;
  description?: string;
  canonicalPath?: string;
  noindex?: boolean;
}

function upsertMetaByName(name: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function syncDocumentSeo(opts: DocumentSeoOptions): void {
  if (typeof document === 'undefined') return;

  document.title = opts.title;

  if (opts.description) {
    upsertMetaByName('description', opts.description);
  }

  upsertMetaByName(
    'robots',
    opts.noindex
      ? 'noindex, nofollow'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
  );

  const canonicalUrl = `${CANONICAL_ORIGIN}${opts.canonicalPath || '/'}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', canonicalUrl);
}
