export function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

export interface CloudRequestContext {
  workspaceId?: string | null;
  shareToken?: string | null;
  csrfToken?: string | null;
}

export function buildCloudHeaders(
  ctx: CloudRequestContext = {},
  extra: HeadersInit = {}
): Headers {
  const headers = new Headers(extra);
  const csrf = ctx.csrfToken || readBrowserCookie('ma_csrf');
  if (csrf && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', csrf);
  }
  if (ctx.workspaceId && !headers.has('X-MyArtifact-Workspace')) {
    headers.set('X-MyArtifact-Workspace', ctx.workspaceId);
  }
  if (ctx.shareToken && !headers.has('X-Share-Token')) {
    headers.set('X-Share-Token', ctx.shareToken);
  }
  return headers;
}

export function cloudFetch(
  input: string,
  init: RequestInit = {},
  ctx: CloudRequestContext = {}
): Promise<Response> {
  const headers = buildCloudHeaders(ctx, init.headers);
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
}
