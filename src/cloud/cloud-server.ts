import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createTwoFilesPatch } from 'diff';
import { buildSandboxHtml } from '../core/sandbox-template.js';
import { resolveArtifactIconSvg, MYARTIFACT_LOGO_SVG } from '../core/icons.js';
import {
  DEFAULT_AGENT_SCOPE_CEILING,
  ELEVATED_CLI_SCOPES,
  ROLE_RANK,
  rankToRole,
  type AgentScope,
  type ArtifactType,
  type AuthPrincipalContext,
  type BatchRevokeRequest,
  type BatchShareRequest,
  type CreateArtifactInput,
  type ShareLinkTargetSpec,
  type TensorBoardScalarPoint,
  type UpdateArtifactInput,
} from '../core/types.js';
import { isSignedLocalTransferStore } from './blob-store.js';
import {
  CloudTokenService,
  generateOpaqueToken,
  generatePkcePair,
  generateUserCode,
  sha256Hex,
  verifyPkceS256,
} from './auth/jwt.js';
import { GoogleOidcVerifier } from './auth/google-oidc.js';
import { CloudPermissionError, isShareLinkValidForContext } from './rbac.js';
import type { CloudPubSubEvent, CloudStore } from './store-interface.js';

export interface CloudServerOptions {
  store: CloudStore;
  tokenService: CloudTokenService;
  oidcVerifier?: GoogleOidcVerifier | null;
  publicBaseUrl?: string;
  publicDir?: string;
  allowedOrigins?: string[];
  enableRealtimeWs?: boolean;
}

interface WsClientRecord {
  ws: WebSocket;
  ctx: AuthPrincipalContext;
  workspaceId?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function parseBodyRaw(req: http.IncomingMessage, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk) => {
      const buf = Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        reject(new CloudPermissionError('Payload too large', 413, 'insufficient_role'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class HttpBadRequestError extends Error {
  public readonly statusCode = 400;
}

const HOST_HEADER_RE = /^(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::\d{1,5})?$/;

function parseValidatedHost(raw: string | string[] | undefined): string | null {
  const rawStr = Array.isArray(raw) ? raw[0] : raw;
  if (!rawStr) return null;
  const first = rawStr.split(',')[0].trim();
  if (!first || !HOST_HEADER_RE.test(first) || first.includes('..')) return null;
  try {
    const u = new URL(`http://${first}`);
    if (!u.hostname) return null;
    return first;
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpBadRequestError('Invalid URL encoding');
  }
}

function sanitizeContentDispositionFilename(raw: string): string {
  return raw.replace(/[\r\n"\\/\x00-\x1f\x7f]/g, '').trim() || 'download';
}

export function sanitizeRelativeRedirectPath(raw: string): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\x00-\x1f\x7f]/.test(raw)) return '/';
  try {
    const parsed = new URL(raw, 'http://localhost');
    if (parsed.origin !== 'http://localhost') return '/';
    return raw;
  } catch {
    return '/';
  }
}

async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await parseBodyRaw(req, 25 * 1024 * 1024);
  const raw = buf.toString('utf8').trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new HttpBadRequestError('Invalid JSON request body');
    }
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpBadRequestError('JSON request body must be an object');
  }
  return parsed as Record<string, unknown>;
}

function sanitizeAgentHeader(raw: unknown): string {
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (!str) return 'cli';
  return str.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'cli';
}

function isLoopbackRedirectUri(rawUri: string): boolean {
  if (!rawUri || /[\x00-\x1f\x7f]/.test(rawUri)) return false;
  try {
    const u = new URL(rawUri);
    if (u.protocol !== 'http:' || u.username || u.password) return false;
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

export class CloudHttpRuntime {
  public readonly store: CloudStore;
  public readonly tokenService: CloudTokenService;
  public readonly oidcVerifier: GoogleOidcVerifier | null;
  private readonly publicDir?: string;
  private readonly allowedOrigins: Set<string>;
  private readonly wsClients = new Set<WsClientRecord>();
  private readonly authRateBuckets = new Map<string, number[]>();
  private publicBaseUrl: string;
  private realtimeWsEnabled: boolean;
  private unsubscribePubSub: (() => void) | null = null;

  constructor(options: CloudServerOptions) {
    this.store = options.store;
    this.tokenService = options.tokenService;
    this.oidcVerifier = options.oidcVerifier ?? GoogleOidcVerifier.fromEnv();
    this.publicDir = options.publicDir;
    this.publicBaseUrl = (options.publicBaseUrl || '').replace(/\/+$/, '');
    this.allowedOrigins = new Set(options.allowedOrigins || []);
    this.realtimeWsEnabled = options.enableRealtimeWs ?? false;

    if (this.publicBaseUrl && isSignedLocalTransferStore(this.store.blobStore)) {
      this.store.blobStore.setBaseUrl(this.publicBaseUrl);
    }

    this.unsubscribePubSub = this.store.subscribe((ev) => {
      void this.fanoutWsEvent(ev);
    });
  }

  public setPublicBaseUrl(baseUrl: string): void {
    this.publicBaseUrl = baseUrl.replace(/\/+$/, '');
    if (this.publicBaseUrl && isSignedLocalTransferStore(this.store.blobStore)) {
      this.store.blobStore.setBaseUrl(this.publicBaseUrl);
    }
  }

  private isProxyTrusted(): boolean {
    return Boolean(process.env.VERCEL || process.env.MYARTIFACT_TRUST_PROXY === 'true');
  }

  private getRequestProto(req: http.IncomingMessage): 'http' | 'https' {
    if (Boolean((req.socket as { encrypted?: boolean }).encrypted)) {
      return 'https';
    }
    if (this.isProxyTrusted()) {
      const raw = req.headers['x-forwarded-proto'];
      const str = Array.isArray(raw) ? raw[0] : raw;
      const first = str ? str.split(',')[0].trim().toLowerCase() : '';
      if (first === 'https') return 'https';
      if (first === 'http') return 'http';
    }
    return 'http';
  }

  private getValidatedRequestHost(req: http.IncomingMessage): string | null {
    if (this.isProxyTrusted()) {
      const fwdHost = parseValidatedHost(req.headers['x-forwarded-host']);
      if (fwdHost) return fwdHost;
    }
    return parseValidatedHost(req.headers.host);
  }

  private getBaseUrl(req: http.IncomingMessage): string {
    if (this.publicBaseUrl) return this.publicBaseUrl;
    const proto = this.getRequestProto(req);
    const host = this.getValidatedRequestHost(req) || '127.0.0.1:4173';
    return `${proto}://${host}`;
  }

  private isSecureRequest(req: http.IncomingMessage): boolean {
    return this.getRequestProto(req) === 'https';
  }

  private getConfiguredPublicOrigin(): string | null {
    if (!this.publicBaseUrl) return null;
    try {
      return new URL(this.publicBaseUrl).origin;
    } catch {
      return this.publicBaseUrl;
    }
  }

  private isAllowedOrigin(req: http.IncomingMessage, origin: string): boolean {
    if (!origin) return false;
    if (this.allowedOrigins.has(origin)) return true;
    const publicOrigin = this.getConfiguredPublicOrigin();
    if (publicOrigin && origin === publicOrigin) return true;
    const validatedHost = this.getValidatedRequestHost(req);
    if (validatedHost) {
      const proto = this.getRequestProto(req);
      if (origin === `${proto}://${validatedHost}`) return true;
    }
    return false;
  }

  private getClientIp(req: http.IncomingMessage): string {
    if (this.isProxyTrusted()) {
      const xff = req.headers['x-forwarded-for'];
      const rawXff = Array.isArray(xff) ? xff[0] : xff;
      if (rawXff) {
        const first = rawXff.split(',')[0].trim();
        if (first) return first;
      }
      const realIp = req.headers['x-real-ip'];
      const rawReal = Array.isArray(realIp) ? realIp[0] : realIp;
      if (rawReal && rawReal.trim()) return rawReal.trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private checkAuthRateLimit(
    req: http.IncomingMessage,
    routeKey: string,
    maxPerMin = 60
  ): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    const ip = this.getClientIp(req);
    const bucketKey = `${routeKey}:${ip}`;
    const existing = this.authRateBuckets.get(bucketKey) || [];
    const recent = existing.filter((ts) => ts > cutoff);
    if (recent.length >= maxPerMin) {
      this.authRateBuckets.set(bucketKey, recent);
      return false;
    }
    recent.push(now);
    this.authRateBuckets.set(bucketKey, recent);
    if (this.authRateBuckets.size > 1000) {
      for (const [k, list] of this.authRateBuckets) {
        if (list.length === 0 || list[list.length - 1] <= cutoff) {
          this.authRateBuckets.delete(k);
        }
      }
    }
    return true;
  }

  private corsHeaders(req: http.IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, X-CSRF-Token, X-MyArtifact-Workspace, X-MyArtifact-Agent, X-Share-Token',
      Vary: 'Origin',
    };
    if (this.isSecureRequest(req)) {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }
    if (origin && this.isAllowedOrigin(req, origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    return headers;
  }

  private sendJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    data: unknown,
    extraHeaders: Record<string, string | string[]> = {}
  ): void {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...this.corsHeaders(req),
      ...extraHeaders,
    });
    res.end(JSON.stringify(data));
  }

  private buildSessionCookies(
    req: http.IncomingMessage,
    sid: string,
    userId: string
  ): { setCookies: string[]; csrfToken: string } {
    const secure = this.isSecureRequest(req);
    const { cookieValue, csrfToken } = this.tokenService.signSessionCookie(sid, userId);
    const cookieName = secure ? '__Host-ma_session' : 'ma_session';
    const secureFlag = secure ? '; Secure' : '';
    const maxAge = 7 * 24 * 3600;
    return {
      csrfToken,
      setCookies: [
        `${cookieName}=${encodeURIComponent(cookieValue)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`,
        `ma_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`,
      ],
    };
  }

  private clearSessionCookies(req: http.IncomingMessage): string[] {
    const secureFlag = this.isSecureRequest(req) ? '; Secure' : '';
    return [
      `__Host-ma_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`,
      `ma_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `ma_csrf=; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`,
    ];
  }

  private async resolveAuthContext(
    req: http.IncomingMessage,
    url: URL,
    enforceCsrfOnMutation = false
  ): Promise<{ ctx: AuthPrincipalContext; csrfToken?: string; cookieAuth: boolean }> {
    let ctx: AuthPrincipalContext = {
      authenticated: false,
      scopes: [],
      viaAgent: 'web',
    };
    let csrfToken: string | undefined;
    let cookieAuth = false;

    const authHeader = req.headers.authorization || '';
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const wsQueryToken = !bearerMatch ? url.searchParams.get('token') : null;
    const rawJwt = bearerMatch?.[1]?.trim() || wsQueryToken || null;

    if (rawJwt) {
      const claims = this.tokenService.verifyAccessJwt(rawJwt);
      if (!claims) {
        throw new CloudPermissionError('Invalid or expired access token', 401, 'unauthenticated');
      }
      const session = await this.store.getAuthSession(claims.sid);
      if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) {
        throw new CloudPermissionError('Session is revoked or expired', 401, 'unauthenticated');
      }
      const user = await this.store.getUserById(claims.sub);
      if (!user) {
        throw new CloudPermissionError('User not found', 401, 'unauthenticated');
      }
      ctx = {
        authenticated: true,
        user,
        sessionId: session.id,
        sessionKind: session.sessionKind,
        scopes: session.scopeCeiling,
        viaAgent: sanitizeAgentHeader(req.headers['x-myartifact-agent']),
        defaultWorkspaceId: session.defaultWorkspaceId || claims.ws,
      };
    } else {
      const cookies = parseCookies(req);
      const rawCookie = cookies['__Host-ma_session'] || cookies['ma_session'];
      if (rawCookie) {
        const parsed = this.tokenService.verifySessionCookie(rawCookie);
        if (parsed) {
          const session = await this.store.getAuthSession(parsed.sid);
          if (session && !session.revokedAt && Date.parse(session.expiresAt) > Date.now()) {
            const user = await this.store.getUserById(parsed.sub);
            if (user) {
              cookieAuth = true;
              csrfToken = parsed.csrf;
              ctx = {
                authenticated: true,
                user,
                sessionId: session.id,
                sessionKind: session.sessionKind,
                scopes: [...ELEVATED_CLI_SCOPES],
                viaAgent: 'web',
                defaultWorkspaceId: session.defaultWorkspaceId,
              };
            }
          }
        }
      }
    }

    if (
      enforceCsrfOnMutation &&
      cookieAuth &&
      req.method &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    ) {
      const headerCsrf =
        typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : '';
      if (!csrfToken || !headerCsrf) {
        throw new CloudPermissionError('Invalid or missing CSRF token', 403, 'insufficient_role');
      }
      const a = Buffer.from(headerCsrf, 'utf8');
      const b = Buffer.from(csrfToken, 'utf8');
      if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new CloudPermissionError('Invalid or missing CSRF token', 403, 'insufficient_role');
      }
    }

    const shareToken =
      (typeof req.headers['x-share-token'] === 'string' && req.headers['x-share-token']) ||
      url.searchParams.get('share') ||
      '';
    if (shareToken) {
      const link = await this.store.resolveShareLinkByToken(shareToken.trim());
      if (link) {
        const valid = isShareLinkValidForContext(link, ctx);
        if (!valid.valid) {
          throw new CloudPermissionError(
            `Share link rejected (${valid.reason})`,
            valid.reason === 'unauthenticated' ? 401 : 403,
            valid.reason || 'insufficient_role'
          );
        }
        ctx.shareLink = link;
        if (!ctx.authenticated) {
          ctx.scopes = ['artifacts:read'];
        }
      }
    }

    return { ctx, csrfToken, cookieAuth };
  }

  private async resolveWorkspaceId(
    req: http.IncomingMessage,
    url: URL,
    ctx: AuthPrincipalContext,
    explicitWs?: string
  ): Promise<string> {
    const requested =
      explicitWs ||
      (typeof req.headers['x-myartifact-workspace'] === 'string'
        ? req.headers['x-myartifact-workspace']
        : '') ||
      url.searchParams.get('workspace') ||
      '';

    if (requested) {
      const ws = await this.store.getWorkspace(requested.trim());
      if (!ws) throw new CloudPermissionError(`Workspace not found: ${requested}`, 404, 'not_found');
      return ws.id;
    }

    if (ctx.shareLink) {
      return ctx.shareLink.workspaceId;
    }

    if (ctx.defaultWorkspaceId) {
      return ctx.defaultWorkspaceId;
    }

    if (ctx.authenticated && ctx.user) {
      const list = await this.store.listWorkspacesForUser(ctx.user.id, ctx.user.googleHd);
      if (list.length > 0) return list[0].id;
    }

    throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
  }

  private async resolveApprovedWorkspaceId(
    ctx: AuthPrincipalContext,
    workspaceRef: string | undefined
  ): Promise<string | undefined> {
    const trimmed = workspaceRef?.trim();
    if (!trimmed) {
      return ctx.defaultWorkspaceId;
    }
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    const ws = await this.store.getWorkspace(trimmed);
    if (!ws) {
      throw new CloudPermissionError(`Workspace not found: ${trimmed}`, 404, 'not_found');
    }
    const workspaces = await this.store.listWorkspacesForUser(ctx.user.id, ctx.user.googleHd);
    if (!workspaces.some((w) => w.id === ws.id)) {
      throw new CloudPermissionError(
        `You do not have access to workspace ${trimmed}`,
        403,
        'insufficient_role'
      );
    }
    return ws.id;
  }

  private async issueTokenBundle(params: {
    userId: string;
    sessionKind: 'cli_delegated' | 'cli_elevated';
    defaultWorkspaceId?: string;
    deviceLabel?: string;
  }) {
    const user = await this.store.getUserById(params.userId);
    if (!user) throw new CloudPermissionError('User not found', 401, 'unauthenticated');

    let wsId = params.defaultWorkspaceId;
    if (!wsId) {
      const workspaces = await this.store.listWorkspacesForUser(user.id, user.googleHd);
      wsId = workspaces[0]?.id;
    }

    const scopes: AgentScope[] =
      params.sessionKind === 'cli_elevated'
        ? [...ELEVATED_CLI_SCOPES]
        : [...DEFAULT_AGENT_SCOPE_CEILING];

    const nowMs = Date.now();
    const refreshTtlDays = params.sessionKind === 'cli_elevated' ? 1 : 90;
    const expiresAtMs = nowMs + refreshTtlDays * 24 * 3600 * 1000;
    const refreshToken =
      params.sessionKind === 'cli_elevated'
        ? `ma_rt_elev.${expiresAtMs.toString(36)}.${crypto.randomBytes(36).toString('base64url')}`
        : generateOpaqueToken('ma_rt_', 36);
    const expiresAt = new Date(expiresAtMs).toISOString();

    const session = await this.store.createAuthSession({
      userId: user.id,
      sessionKind: params.sessionKind,
      refreshTokenHash: sha256Hex(refreshToken),
      scopeCeiling: scopes,
      defaultWorkspaceId: wsId,
      deviceLabel: params.deviceLabel || 'CLI',
      expiresAt,
    });

    const accessToken = this.tokenService.signAccessJwt(
      {
        sub: user.id,
        sid: session.id,
        email: user.email,
        ...(user.googleHd ? { hd: user.googleHd } : {}),
        sessionKind: session.sessionKind,
        scopes,
        ...(wsId ? { ws: wsId } : {}),
      },
      900
    );

    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: 900,
      sessionId: session.id,
      sessionKind: session.sessionKind,
      scopes,
      defaultWorkspaceId: wsId,
      user,
    };
  }

  public attachWebSocketServer(server: http.Server): WebSocketServer {
    if (process.env.MYARTIFACT_ENABLE_WS !== 'false') {
      this.realtimeWsEnabled = true;
    }
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (req, socket, head) => {
      socket.on('error', () => {});
      try {
        const safeHost = parseValidatedHost(req.headers.host) || 'localhost';
        const url = new URL(req.url || '/', `http://${safeHost}`);
        if (url.pathname !== '/ws') {
          socket.destroy();
          return;
        }
        const origin = req.headers.origin;
        if (origin !== undefined && !this.isAllowedOrigin(req, origin)) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        const { ctx } = await this.resolveAuthContext(req, url, false);
        if (!ctx.authenticated && !ctx.shareLink) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        const requestedWs = url.searchParams.get('workspace') || undefined;
        let resolvedWsId: string | undefined;
        try {
          resolvedWsId = await this.resolveWorkspaceId(req, url, ctx, requestedWs);
        } catch {
          resolvedWsId = undefined;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          const rec: WsClientRecord = { ws, ctx, workspaceId: resolvedWsId };
          this.wsClients.add(rec);
          ws.on('close', () => this.wsClients.delete(rec));
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    return wss;
  }

  private async fanoutWsEvent(ev: CloudPubSubEvent): Promise<void> {
    const msg = JSON.stringify(ev.payload);
    for (const client of this.wsClients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.workspaceId && client.workspaceId !== ev.workspaceId) continue;

      try {
        if (ev.artifactId) {
          const resolved = await this.store.resolveArtifactRole(
            client.ctx,
            ev.workspaceId,
            ev.artifactId
          );
          if (!resolved || !resolved.role) continue;
        } else if (ev.type === 'acl:updated') {
          const wsRole = await this.store.resolveWorkspaceRole(client.ctx, ev.workspaceId);
          if (!wsRole && !client.ctx.shareLink) continue;
        }
        client.ws.send(msg);
      } catch {
        // Drop unauthorized broadcast
      }
    }
  }

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, this.corsHeaders(req));
        res.end();
        return;
      }

      const rawReqUrl = req.url || '/';
      const safeReqUrl = rawReqUrl.startsWith('//') ? '/' + rawReqUrl.replace(/^\/+/, '') : rawReqUrl;
      const safeHost = parseValidatedHost(req.headers.host) || 'localhost';
      let url: URL;
      try {
        url = new URL(safeReqUrl, `http://${safeHost}`);
      } catch {
        throw new HttpBadRequestError('Invalid request URL');
      }
      const pathname = url.pathname;
      const baseOrigin = this.getBaseUrl(req);

      if (pathname === '/favicon.svg' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(MYARTIFACT_LOGO_SVG);
        return;
      }

      if (pathname === '/api/health' && req.method === 'GET') {
        this.sendJson(req, res, 200, {
          ok: true,
          mode: 'cloud',
          blobStore: this.store.blobStore.kind,
          googleOidcConfigured: Boolean(this.oidcVerifier),
          realtimeWs: this.realtimeWsEnabled,
          serverless: Boolean(process.env.VERCEL),
        });
        return;
      }

      // Signed app-hosted presigned upload/download routes (LocalDiskBlobStore & PostgresBlobStore)
      if (pathname === '/api/blobs/upload' && req.method === 'PUT') {
        const blobStore = this.store.blobStore;
        if (!isSignedLocalTransferStore(blobStore)) {
          this.sendJson(req, res, 404, { error: 'Not using signed local/postgres blob store' });
          return;
        }
        const key = url.searchParams.get('key') || '';
        const exp = Number(url.searchParams.get('exp') || 0);
        const sig = url.searchParams.get('sig') || '';
        if (!blobStore.verifySignedLocalToken('upload', key, exp, sig)) {
          this.sendJson(req, res, 403, { error: 'Invalid or expired upload signature' });
          return;
        }
        const buf = await parseBodyRaw(req, 256 * 1024 * 1024);
        const put = await blobStore.putObject(key, buf);
        this.sendJson(req, res, 200, { ok: true, ...put });
        return;
      }

      if (pathname === '/api/blobs/download' && req.method === 'GET') {
        const blobStore = this.store.blobStore;
        if (!isSignedLocalTransferStore(blobStore)) {
          this.sendJson(req, res, 404, { error: 'Not using signed local/postgres blob store' });
          return;
        }
        const key = url.searchParams.get('key') || '';
        const exp = Number(url.searchParams.get('exp') || 0);
        const sig = url.searchParams.get('sig') || '';
        const fn = url.searchParams.get('fn') || path.basename(key);
        if (!blobStore.verifySignedLocalToken('download', key, exp, sig)) {
          this.sendJson(req, res, 403, { error: 'Invalid or expired download signature' });
          return;
        }
        const buf = await blobStore.getObjectBuffer(key);
        if (!buf) {
          this.sendJson(req, res, 404, { error: 'Object not found' });
          return;
        }
        const safeFn = sanitizeContentDispositionFilename(fn);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeFn}"`,
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(buf);
        return;
      }

      // =====================================================================
      // Auth & OIDC Endpoints
      // =====================================================================
      if (pathname === '/api/auth/providers' && req.method === 'GET') {
        this.sendJson(req, res, 200, {
          mode: 'cloud',
          googleEnabled: Boolean(this.oidcVerifier),
          googleClientId: this.oidcVerifier?.clientId || null,
          allowDeviceFlow: true,
          realtimeWs: this.realtimeWsEnabled,
        });
        return;
      }

      if (pathname === '/api/auth/google/login' && req.method === 'GET') {
        if (!this.oidcVerifier) {
          this.sendJson(req, res, 503, { error: 'Google OIDC is not configured on this server' });
          return;
        }
        const state = generateOpaqueToken('st_', 24);
        const nonce = generateOpaqueToken('nc_', 24);
        const pkce = generatePkcePair();
        const callbackUri = `${baseOrigin}/api/auth/google/callback`;
        const flowKind =
          url.searchParams.get('flow') === 'cli_loopback' ? 'cli_loopback' : 'web';
        const nextPath = sanitizeRelativeRedirectPath(url.searchParams.get('next') || '/');
        const cliRedirectUri = url.searchParams.get('cli_redirect_uri') || undefined;
        const cliChallenge = url.searchParams.get('cli_challenge') || undefined;
        const cliState = url.searchParams.get('cli_state') || undefined;
        const elevate = url.searchParams.get('elevate') === '1';
        const requestedWorkspace = url.searchParams.get('workspace') || undefined;

        if (flowKind === 'cli_loopback') {
          if (!cliRedirectUri || !isLoopbackRedirectUri(cliRedirectUri)) {
            this.sendJson(req, res, 400, {
              error: 'cli_redirect_uri must be a loopback http://127.0.0.1 or localhost URL',
            });
            return;
          }
        }

        await this.store.saveOAuthState({
          state,
          nonce,
          codeVerifier: pkce.codeVerifier,
          flowKind,
          redirectUri: callbackUri,
          cliChallenge,
          cliRedirectUri: flowKind === 'cli_loopback' ? cliRedirectUri : nextPath,
          cliState,
          elevate,
          requestedWorkspace,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        });

        const authUrl = this.oidcVerifier.buildAuthorizationUrl({
          redirectUri: callbackUri,
          state,
          nonce,
          codeChallenge: pkce.codeChallenge,
          hd: url.searchParams.get('hd') || undefined,
        });
        res.writeHead(302, { Location: authUrl });
        res.end();
        return;
      }

      if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
        if (!this.oidcVerifier) {
          this.sendJson(req, res, 503, { error: 'Google OIDC not configured' });
          return;
        }
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const errParam = url.searchParams.get('error');
        if (errParam) {
          this.sendJson(req, res, 400, { error: `Google sign-in aborted: ${errParam}` });
          return;
        }
        const oauthState = await this.store.consumeOAuthState(state);
        if (!oauthState || !code) {
          this.sendJson(req, res, 400, { error: 'Invalid or expired OAuth state' });
          return;
        }

        const profile = await this.oidcVerifier.exchangeCodeAndVerify({
          code,
          redirectUri: oauthState.redirectUri,
          codeVerifier: oauthState.codeVerifier,
          expectedNonce: oauthState.nonce,
        });
        const { user, personalWorkspace } = await this.store.upsertGoogleUser(profile);

        const webSession = await this.store.createAuthSession({
          userId: user.id,
          sessionKind: 'web',
          refreshTokenHash: sha256Hex(generateOpaqueToken('web_rt_', 32)),
          scopeCeiling: [...ELEVATED_CLI_SCOPES],
          defaultWorkspaceId: personalWorkspace.id,
          deviceLabel: 'Web Browser',
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        });

        const { setCookies } = this.buildSessionCookies(req, webSession.id, user.id);

        let redirectLocation = '/';
        if (
          oauthState.flowKind === 'cli_loopback' &&
          oauthState.cliRedirectUri &&
          oauthState.cliChallenge &&
          isLoopbackRedirectUri(oauthState.cliRedirectUri)
        ) {
          const qs = new URLSearchParams({
            redirect_uri: oauthState.cliRedirectUri,
            code_challenge: oauthState.cliChallenge,
            code_challenge_method: 'S256',
            ...(oauthState.cliState ? { state: oauthState.cliState } : {}),
            ...(oauthState.elevate ? { elevate: '1' } : {}),
            ...(oauthState.requestedWorkspace ? { workspace: oauthState.requestedWorkspace } : {}),
          });
          redirectLocation = `/auth/cli/authorize?${qs.toString()}`;
        } else if (oauthState.cliRedirectUri) {
          redirectLocation = sanitizeRelativeRedirectPath(oauthState.cliRedirectUri);
        }

        res.writeHead(302, {
          Location: redirectLocation,
          'Set-Cookie': setCookies,
        });
        res.end();
        return;
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const { ctx, csrfToken } = await this.resolveAuthContext(req, url, false);
        if (!ctx.authenticated || !ctx.user) {
          this.sendJson(req, res, 200, {
            authenticated: false,
            mode: 'cloud',
            shareLink: ctx.shareLink || null,
          });
          return;
        }
        const workspaces = await this.store.listWorkspacesForUser(ctx.user.id, ctx.user.googleHd);
        this.sendJson(req, res, 200, {
          authenticated: true,
          mode: 'cloud',
          user: ctx.user,
          workspaces,
          defaultWorkspaceId: ctx.defaultWorkspaceId || workspaces[0]?.id,
          sessionId: ctx.sessionId,
          sessionKind: ctx.sessionKind,
          scopes: ctx.scopes,
          ...(csrfToken ? { csrfToken } : {}),
        });
        return;
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const { ctx } = await this.resolveAuthContext(req, url, true);
        if (ctx.authenticated && ctx.user && ctx.sessionId) {
          await this.store.revokeSession(ctx.sessionId, ctx.user.id);
        }
        this.sendJson(
          req,
          res,
          200,
          { ok: true },
          { 'Set-Cookie': this.clearSessionCookies(req) }
        );
        return;
      }

      if (pathname === '/api/auth/sessions' && req.method === 'GET') {
        const { ctx } = await this.resolveAuthContext(req, url, false);
        if (!ctx.authenticated || !ctx.user) {
          this.sendJson(req, res, 401, { error: 'Authentication required' });
          return;
        }
        const sessions = await this.store.listUserSessions(ctx.user.id);
        this.sendJson(req, res, 200, { sessions });
        return;
      }

      const sessionMatch = pathname.match(/^\/api\/auth\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === 'DELETE') {
        const { ctx } = await this.resolveAuthContext(req, url, true);
        if (!ctx.authenticated || !ctx.user) {
          this.sendJson(req, res, 401, { error: 'Authentication required' });
          return;
        }
        const revoked = await this.store.revokeSession(
          safeDecodeURIComponent(sessionMatch[1]),
          ctx.user.id
        );
        this.sendJson(req, res, revoked ? 200 : 404, { revoked });
        return;
      }

      // CLI Loopback Approve (authenticated web user approves CLI + Safe Agent Ceiling)
      if (pathname === '/api/auth/cli/approve' && req.method === 'POST') {
        const { ctx } = await this.resolveAuthContext(req, url, true);
        if (!ctx.authenticated || !ctx.user) {
          this.sendJson(req, res, 401, { error: 'Web sign-in required to authorize CLI' });
          return;
        }
        if (ctx.sessionKind !== 'web') {
          throw new CloudPermissionError(
            'Interactive web sign-in required to authorize CLI or device sessions',
            403,
            'agent_scope_restricted'
          );
        }
        const body = await parseJsonBody(req);
        const redirectUri = String(body.redirectUri || '');
        const codeChallenge = String(body.codeChallenge || '');
        const state = typeof body.state === 'string' ? body.state : '';
        const elevate = Boolean(body.elevate);
        const workspaceRef = typeof body.workspace === 'string' ? body.workspace : undefined;
        const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel : 'CLI Agent';

        if (!isLoopbackRedirectUri(redirectUri)) {
          this.sendJson(req, res, 400, { error: 'redirectUri must be a loopback http://127.0.0.1 or localhost URL' });
          return;
        }
        if (!codeChallenge) {
          this.sendJson(req, res, 400, { error: 'codeChallenge is required' });
          return;
        }

        const defaultWorkspaceId = await this.resolveApprovedWorkspaceId(ctx, workspaceRef);

        const code = generateOpaqueToken('ma_ac_', 24);
        await this.store.saveCliAuthCode({
          codeHash: sha256Hex(code),
          userId: ctx.user.id,
          codeChallenge,
          redirectUri,
          elevate,
          defaultWorkspaceId,
          deviceLabel,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });

        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        if (state) target.searchParams.set('state', state);
        this.sendJson(req, res, 200, { redirectUrl: target.toString() });
        return;
      }

      // OAuth Token Exchange (CLI authorization_code + rotating refresh_token)
      if (pathname === '/api/auth/token' && req.method === 'POST') {
        if (!this.checkAuthRateLimit(req, '/api/auth/token')) {
          this.sendJson(
            req,
            res,
            429,
            { error: 'Too many authentication requests' },
            { 'Retry-After': '60' }
          );
          return;
        }
        const body = await parseJsonBody(req);
        const grantType = String(body.grant_type || body.grantType || '');

        if (grantType === 'authorization_code') {
          const code = String(body.code || '');
          const codeVerifier = String(body.code_verifier || body.codeVerifier || '');
          const redirectUri = String(body.redirect_uri || body.redirectUri || '');
          const record = await this.store.consumeCliAuthCode(sha256Hex(code));
          if (!record) {
            this.sendJson(req, res, 400, { error: 'invalid_grant', message: 'Invalid or expired authorization code' });
            return;
          }
          if (record.redirectUri !== redirectUri || !verifyPkceS256(codeVerifier, record.codeChallenge)) {
            this.sendJson(req, res, 400, { error: 'invalid_grant', message: 'PKCE verifier or redirect_uri mismatch' });
            return;
          }
          const bundle = await this.issueTokenBundle({
            userId: record.userId,
            sessionKind: record.elevate ? 'cli_elevated' : 'cli_delegated',
            defaultWorkspaceId: record.defaultWorkspaceId,
            deviceLabel: record.deviceLabel,
          });
          this.sendJson(req, res, 200, bundle);
          return;
        }

        if (grantType === 'refresh_token') {
          const presented = String(body.refresh_token || body.refreshToken || '');
          if (!presented) {
            this.sendJson(req, res, 400, { error: 'refresh_token is required' });
            return;
          }
          const nowMs = Date.now();
          const oneDayMs = 24 * 3600 * 1000;
          const ninetyDaysMs = 90 * 24 * 3600 * 1000;
          const elevMatch = presented.match(/^ma_rt_elev\.([0-9a-z]+)\./);
          let nextRefreshToken: string;
          let nextExpiresAtMs: number;
          if (elevMatch) {
            const parsedCap = Number.parseInt(elevMatch[1], 36);
            nextExpiresAtMs =
              Number.isFinite(parsedCap) && parsedCap > 0
                ? Math.min(parsedCap, nowMs + oneDayMs)
                : nowMs + oneDayMs;
            nextRefreshToken = `ma_rt_elev.${nextExpiresAtMs.toString(36)}.${crypto.randomBytes(36).toString('base64url')}`;
          } else {
            nextExpiresAtMs = nowMs + ninetyDaysMs;
            nextRefreshToken = generateOpaqueToken('ma_rt_', 36);
          }

          let rotated = await this.store.rotateRefreshToken({
            presentedTokenHash: sha256Hex(presented),
            nextRefreshTokenHash: sha256Hex(nextRefreshToken),
            nextExpiresAt: new Date(nextExpiresAtMs).toISOString(),
            graceWindowMs: 30_000,
          });
          let finalRefreshToken = nextRefreshToken;

          if (rotated.session.sessionKind === 'cli_elevated') {
            const createdMs = Date.parse(rotated.session.createdAt);
            const capMs = Math.min(
              (Number.isFinite(createdMs) ? createdMs : nowMs) + oneDayMs,
              nowMs + oneDayMs
            );
            if (capMs <= Date.now()) {
              await this.store.revokeSession(rotated.session.id, rotated.user.id);
              throw new CloudPermissionError('Elevated session has expired', 401, 'unauthenticated');
            }
            const rotatedExpMs = Date.parse(rotated.session.expiresAt);
            if (!rotated.usedGraceWindow && (!Number.isFinite(rotatedExpMs) || rotatedExpMs > capMs + 5000)) {
              const clampedToken = `ma_rt_elev.${capMs.toString(36)}.${crypto.randomBytes(36).toString('base64url')}`;
              rotated = await this.store.rotateRefreshToken({
                presentedTokenHash: sha256Hex(nextRefreshToken),
                nextRefreshTokenHash: sha256Hex(clampedToken),
                nextExpiresAt: new Date(capMs).toISOString(),
                graceWindowMs: 30_000,
              });
              finalRefreshToken = clampedToken;
            }
          }

          const remainingSec = Math.floor((Date.parse(rotated.session.expiresAt) - Date.now()) / 1000);
          const accessTtl =
            rotated.session.sessionKind === 'cli_elevated' && Number.isFinite(remainingSec)
              ? Math.max(1, Math.min(900, remainingSec))
              : 900;

          const accessToken = this.tokenService.signAccessJwt(
            {
              sub: rotated.user.id,
              sid: rotated.session.id,
              email: rotated.user.email,
              ...(rotated.user.googleHd ? { hd: rotated.user.googleHd } : {}),
              sessionKind: rotated.session.sessionKind,
              scopes: rotated.session.scopeCeiling,
              ...(rotated.session.defaultWorkspaceId
                ? { ws: rotated.session.defaultWorkspaceId }
                : {}),
            },
            accessTtl
          );

          this.sendJson(req, res, 200, {
            tokenType: 'Bearer',
            accessToken,
            refreshToken: finalRefreshToken,
            expiresIn: accessTtl,
            sessionId: rotated.session.id,
            sessionKind: rotated.session.sessionKind,
            scopes: rotated.session.scopeCeiling,
            defaultWorkspaceId: rotated.session.defaultWorkspaceId,
            user: rotated.user,
            usedGraceWindow: rotated.usedGraceWindow,
          });
          return;
        }

        this.sendJson(req, res, 400, { error: 'unsupported_grant_type' });
        return;
      }

      // RFC 8628 Device Flow
      if (pathname === '/api/auth/device/code' && req.method === 'POST') {
        if (!this.checkAuthRateLimit(req, '/api/auth/device/code')) {
          this.sendJson(
            req,
            res,
            429,
            { error: 'Too many authentication requests' },
            { 'Retry-After': '60' }
          );
          return;
        }
        const body = await parseJsonBody(req);
        const deviceCode = generateOpaqueToken('ma_dc_', 24);
        const userCode = generateUserCode();
        const elevate = Boolean(body.elevate);
        const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel : 'CLI Device';
        const now = new Date().toISOString();
        await this.store.createDeviceAuthCode({
          deviceCodeHash: sha256Hex(deviceCode),
          userCode,
          status: 'pending',
          elevate,
          defaultWorkspaceId: undefined,
          deviceLabel,
          intervalSec: 2,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          createdAt: now,
        });
        const verificationUri = `${baseOrigin}/auth/device`;
        const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;
        this.sendJson(req, res, 200, {
          deviceCode,
          userCode,
          verificationUri,
          verificationUriComplete,
          expiresIn: 600,
          interval: 2,
        });
        return;
      }

      if (pathname === '/api/auth/device/approve' && req.method === 'POST') {
        if (!this.checkAuthRateLimit(req, '/api/auth/device/approve')) {
          this.sendJson(
            req,
            res,
            429,
            { error: 'Too many authentication requests' },
            { 'Retry-After': '60' }
          );
          return;
        }
        const { ctx } = await this.resolveAuthContext(req, url, true);
        if (!ctx.authenticated || !ctx.user) {
          this.sendJson(req, res, 401, { error: 'Web sign-in required' });
          return;
        }
        if (ctx.sessionKind !== 'web') {
          throw new CloudPermissionError(
            'Interactive web sign-in required to authorize CLI or device sessions',
            403,
            'agent_scope_restricted'
          );
        }
        const body = await parseJsonBody(req);
        const userCode = String(body.userCode || body.user_code || '');
        const workspaceRef = typeof body.workspace === 'string' ? body.workspace : undefined;
        const wsId = await this.resolveApprovedWorkspaceId(ctx, workspaceRef);
        const approved = await this.store.approveDeviceAuthCode(
          userCode,
          ctx.user.id,
          wsId,
          typeof body.elevate === 'boolean' ? body.elevate : undefined
        );
        if (!approved) {
          this.sendJson(req, res, 404, { error: 'Invalid, expired, or already used user code' });
          return;
        }
        this.sendJson(req, res, 200, { approved: true, userCode: approved.userCode });
        return;
      }

      if (pathname === '/api/auth/device/token' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const deviceCode = String(body.deviceCode || body.device_code || '');
        const rec = await this.store.getDeviceAuthByDeviceCodeHash(sha256Hex(deviceCode));
        if (!rec || Date.parse(rec.expiresAt) <= Date.now()) {
          this.sendJson(req, res, 400, { error: 'expired_token' });
          return;
        }
        if (rec.status === 'pending') {
          this.sendJson(req, res, 400, { error: 'authorization_pending' });
          return;
        }
        if (rec.status === 'denied' || rec.status === 'consumed') {
          this.sendJson(req, res, 400, { error: 'access_denied' });
          return;
        }
        const consumed = await this.store.consumeDeviceAuthCode(rec.deviceCodeHash);
        if (!consumed || !consumed.userId) {
          this.sendJson(req, res, 400, { error: 'invalid_grant' });
          return;
        }
        const bundle = await this.issueTokenBundle({
          userId: consumed.userId,
          sessionKind: consumed.elevate ? 'cli_elevated' : 'cli_delegated',
          defaultWorkspaceId: consumed.defaultWorkspaceId,
          deviceLabel: consumed.deviceLabel,
        });
        this.sendJson(req, res, 200, bundle);
        return;
      }

      // =====================================================================
      // Share Link Public/Domain Bundle Endpoint (/api/share/:token)
      // =====================================================================
      const shareBundleMatch = pathname.match(/^\/api\/share\/([^/]+)$/);
      if (shareBundleMatch && req.method === 'GET') {
        const { ctx } = await this.resolveAuthContext(req, url, false);
        const token = safeDecodeURIComponent(shareBundleMatch[1]);
        const bundle = await this.store.getShareLinkBundle(ctx, token);
        this.sendJson(req, res, 200, bundle);
        return;
      }

      // =====================================================================
      // Workspaces, Projects, Groups, Batch IAM & Audit Routes
      // =====================================================================
      if (pathname === '/api/workspaces' && req.method === 'GET') {
        const { ctx } = await this.resolveAuthContext(req, url, false);
        if (!ctx.authenticated || !ctx.user) {
          this.sendJson(req, res, 401, { error: 'Authentication required' });
          return;
        }
        const workspaces = await this.store.listWorkspacesForUser(ctx.user.id, ctx.user.googleHd);
        this.sendJson(req, res, 200, { workspaces });
        return;
      }

      if (pathname === '/api/workspaces' && req.method === 'POST') {
        const { ctx } = await this.resolveAuthContext(req, url, true);
        const body = await parseJsonBody(req);
        if (!body.name || typeof body.name !== 'string') {
          this.sendJson(req, res, 400, { error: 'name is required' });
          return;
        }
        const workspace = await this.store.createWorkspace(ctx, {
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          name: body.name,
          allowedGoogleHd:
            typeof body.allowedGoogleHd === 'string' ? body.allowedGoogleHd : undefined,
        });
        this.sendJson(req, res, 201, { workspace });
        return;
      }

      const wsParts = pathname.split('/').filter(Boolean);
      if (wsParts[0] === 'api' && wsParts[1] === 'workspaces' && wsParts[2]) {
        const wsRef = safeDecodeURIComponent(wsParts[2]);
        const { ctx } = await this.resolveAuthContext(req, url, true);
        const ws = await this.store.getWorkspace(wsRef);
        if (!ws) {
          this.sendJson(req, res, 404, { error: `Workspace not found: ${wsRef}` });
          return;
        }
        const wsId = ws.id;

        if (wsParts[3] === 'projects' && wsParts.length === 4 && req.method === 'GET') {
          const projects = await this.store.listProjects(ctx, wsId);
          this.sendJson(req, res, 200, { projects });
          return;
        }

        if (
          wsParts[3] === 'projects' &&
          wsParts[4] &&
          wsParts[5] === 'visibility' &&
          req.method === 'PATCH'
        ) {
          const body = await parseJsonBody(req);
          const project = await this.store.setProjectVisibility(
            ctx,
            wsId,
            safeDecodeURIComponent(wsParts[4]),
            Boolean(body.inheritWorkspaceAcl)
          );
          this.sendJson(req, res, 200, { project });
          return;
        }

        if (wsParts[3] === 'groups' && wsParts.length === 4 && req.method === 'GET') {
          const groups = await this.store.listGroups(ctx, wsId);
          this.sendJson(req, res, 200, { groups });
          return;
        }

        if (wsParts[3] === 'groups' && wsParts.length === 4 && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const group = await this.store.createGroup(ctx, wsId, {
            slug: typeof body.slug === 'string' ? body.slug : undefined,
            name: String(body.name || 'Team'),
            description: typeof body.description === 'string' ? body.description : undefined,
            memberEmails: Array.isArray(body.memberEmails) ? body.memberEmails.map(String) : [],
          });
          this.sendJson(req, res, 201, { group });
          return;
        }

        if (
          wsParts[3] === 'groups' &&
          wsParts[4] &&
          wsParts[5] === 'members' &&
          req.method === 'PATCH'
        ) {
          const body = await parseJsonBody(req);
          const group = await this.store.updateGroupMembers(
            ctx,
            wsId,
            safeDecodeURIComponent(wsParts[4]),
            {
              addEmails: Array.isArray(body.addEmails) ? body.addEmails.map(String) : undefined,
              removeEmails: Array.isArray(body.removeEmails) ? body.removeEmails.map(String) : undefined,
            }
          );
          this.sendJson(req, res, 200, { group });
          return;
        }

        if (wsParts[3] === 'iam' && wsParts[4] === 'acl' && req.method === 'GET') {
          const resourceType = (url.searchParams.get('resourceType') || 'workspace') as
            | 'workspace'
            | 'project'
            | 'category'
            | 'artifact';
          const resourceKey = url.searchParams.get('resourceKey') || wsId;
          const acl = await this.store.getResourceAcl(ctx, wsId, resourceType, resourceKey);
          this.sendJson(req, res, 200, acl);
          return;
        }

        if (wsParts[3] === 'iam' && wsParts[4] === 'grants:batch' && req.method === 'POST') {
          const body = (await parseJsonBody(req)) as unknown as BatchShareRequest;
          const result = await this.store.applyBatchGrants(ctx, wsId, body);
          this.sendJson(req, res, 200, result);
          return;
        }

        if (wsParts[3] === 'iam' && wsParts[4] === 'grants:revoke-batch' && req.method === 'POST') {
          const body = (await parseJsonBody(req)) as unknown as BatchRevokeRequest;
          const result = await this.store.revokeBatchGrants(ctx, wsId, body);
          this.sendJson(req, res, 200, result);
          return;
        }

        if (wsParts[3] === 'iam' && wsParts[4] === 'share-links' && wsParts.length === 5) {
          if (req.method === 'GET') {
            const links = await this.store.listShareLinks(ctx, wsId);
            this.sendJson(req, res, 200, { links });
            return;
          }
          if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const created = await this.store.createShareLink(ctx, wsId, {
              accessMode: body.accessMode === 'domain' ? 'domain' : 'anyone',
              requiredHd: typeof body.requiredHd === 'string' ? body.requiredHd : undefined,
              role: body.role === 'editor' ? 'editor' : 'viewer',
              targetSpec: (body.targetSpec || { kind: 'workspace' }) as ShareLinkTargetSpec,
              label: typeof body.label === 'string' ? body.label : undefined,
              expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
            });
            const shareUrl = `${baseOrigin}/s/${encodeURIComponent(created.token)}`;
            this.sendJson(req, res, 201, { ...created, shareUrl });
            return;
          }
        }

        if (
          wsParts[3] === 'iam' &&
          wsParts[4] === 'share-links' &&
          wsParts[5] &&
          req.method === 'DELETE'
        ) {
          const revoked = await this.store.revokeShareLink(
            ctx,
            wsId,
            safeDecodeURIComponent(wsParts[5])
          );
          this.sendJson(req, res, revoked ? 200 : 404, { revoked });
          return;
        }

        if (wsParts[3] === 'audit' && req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') || 100);
          const events = await this.store.listAuditEvents(ctx, wsId, limit);
          this.sendJson(req, res, 200, { events });
          return;
        }
      }

      // =====================================================================
      // Workspace-Scoped & Active-Workspace Artifact / Wiki / TensorBoard API
      // =====================================================================
      let apiPath = pathname;
      let explicitWsFromPath: string | undefined;
      const scopedMatch = pathname.match(/^\/api\/w\/([^/]+)(\/.*)$/);
      if (scopedMatch) {
        explicitWsFromPath = safeDecodeURIComponent(scopedMatch[1]);
        apiPath = `/api${scopedMatch[2]}`;
      }

      if (apiPath.startsWith('/api/')) {
        const { ctx } = await this.resolveAuthContext(req, url, true);
        const wsId = await this.resolveWorkspaceId(req, url, ctx, explicitWsFromPath);
        const buildLinks = (slug: string) => ({
          url: `${baseOrigin}/artifacts/${encodeURIComponent(slug)}?ws=${encodeURIComponent(wsId)}`,
          previewUrl: `${baseOrigin}/artifacts/${encodeURIComponent(slug)}?ws=${encodeURIComponent(wsId)}`,
          studioUrl: `${baseOrigin}/?view=studio&artifact=${encodeURIComponent(slug)}&ws=${encodeURIComponent(wsId)}`,
        });

        if (apiPath === '/api/sync' && req.method === 'GET') {
          const selected = url.searchParams.get('artifact') || undefined;
          const sync = await this.store.getWorkspaceSyncState(ctx, wsId, selected);
          const etag = `W/"${sync.revision}"`;
          const inm = req.headers['if-none-match'];
          if (inm && inm === etag) {
            res.writeHead(304, {
              ...this.corsHeaders(req),
              ETag: etag,
              'Cache-Control': 'private, no-cache',
            });
            res.end();
            return;
          }
          this.sendJson(req, res, 200, sync, {
            ETag: etag,
            'Cache-Control': 'private, no-cache',
          });
          return;
        }

        if (apiPath === '/api/wiki' && req.method === 'GET') {
          const projFilter = url.searchParams.get('project') || undefined;
          const wiki = await this.store.getWikiData(ctx, wsId, projFilter);
          this.sendJson(req, res, 200, wiki);
          return;
        }

        if (apiPath === '/api/artifacts' && req.method === 'GET') {
          const artifacts = await this.store.listArtifacts(ctx, wsId, {
            query: url.searchParams.get('q') || undefined,
            agent: url.searchParams.get('agent') || undefined,
            type: (url.searchParams.get('type') as ArtifactType) || undefined,
            project: url.searchParams.get('project') || undefined,
            category: url.searchParams.get('category') || undefined,
            tag: url.searchParams.get('tag') || undefined,
            limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
          });
          this.sendJson(req, res, 200, { artifacts, workspaceId: wsId });
          return;
        }

        if (apiPath === '/api/artifacts' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!body.content || typeof body.content !== 'string') {
            this.sendJson(req, res, 400, { error: 'content is required' });
            return;
          }
          const input: CreateArtifactInput = {
            slug: typeof body.slug === 'string' ? body.slug : undefined,
            title: typeof body.title === 'string' && body.title ? body.title : 'Untitled Artifact',
            description: typeof body.description === 'string' ? body.description : undefined,
            type: typeof body.type === 'string' ? (body.type as ArtifactType) : undefined,
            language: typeof body.language === 'string' ? body.language : undefined,
            content: body.content,
            agent: typeof body.agent === 'string' ? body.agent : ctx.viaAgent,
            project: typeof body.project === 'string' ? body.project : 'default',
            category: typeof body.category === 'string' ? body.category : undefined,
            tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
            links: Array.isArray(body.links) ? body.links.map(String) : undefined,
            icon: typeof body.icon === 'string' ? body.icon : undefined,
            summary: typeof body.summary === 'string' ? body.summary : undefined,
          };
          const artifact =
            body.upsert && input.slug
              ? await this.store.upsertBySlug(ctx, wsId, input.slug, input)
              : await this.store.createArtifact(ctx, wsId, input);
          this.sendJson(req, res, 201, { artifact, ...buildLinks(artifact.slug) });
          return;
        }

        // TensorBoard routes
        if (apiPath === '/api/tensorboard/runs' && req.method === 'GET') {
          const runs = await this.store.listArtifacts(ctx, wsId, { type: 'tensorboard' });
          const hydrated = await Promise.all(
            runs.map(async (r) => ({
              ...r,
              checkpoints: await this.store.getModelCheckpoints(ctx, wsId, r.id),
            }))
          );
          this.sendJson(req, res, 200, { runs: hydrated });
          return;
        }

        const tbParts = apiPath.split('/').filter(Boolean);
        if (tbParts[0] === 'api' && tbParts[1] === 'tensorboard' && tbParts[2] === 'runs' && tbParts[3]) {
          const runSlug = safeDecodeURIComponent(tbParts[3]);
          if (tbParts[4] === 'scalars' && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const artifact = await this.store.logTensorBoardScalars(ctx, wsId, {
              slug: runSlug,
              title: typeof body.title === 'string' ? body.title : undefined,
              experiment: typeof body.experiment === 'string' ? body.experiment : undefined,
              modelName: typeof body.modelName === 'string' ? body.modelName : undefined,
              framework: typeof body.framework === 'string' ? body.framework : undefined,
              status:
                body.status === 'running' || body.status === 'completed' || body.status === 'failed'
                  ? body.status
                  : undefined,
              agent: typeof body.agent === 'string' ? body.agent : ctx.viaAgent,
              project: typeof body.project === 'string' ? body.project : undefined,
              hparams:
                body.hparams && typeof body.hparams === 'object'
                  ? (body.hparams as Record<string, string | number | boolean>)
                  : undefined,
              step: typeof body.step === 'number' ? body.step : undefined,
              epoch: typeof body.epoch === 'number' ? body.epoch : undefined,
              wallTime: typeof body.wallTime === 'number' ? body.wallTime : undefined,
              metrics:
                body.metrics && typeof body.metrics === 'object'
                  ? (body.metrics as Record<string, number>)
                  : undefined,
              scalars: Array.isArray(body.scalars)
                ? (body.scalars as TensorBoardScalarPoint[])
                : undefined,
              summary: typeof body.summary === 'string' ? body.summary : undefined,
            });
            this.sendJson(req, res, 200, { artifact, ...buildLinks(artifact.slug) });
            return;
          }

          if (tbParts[4] === 'checkpoints:presign' && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const resPresign = await this.store.presignCheckpointUpload(ctx, wsId, runSlug, {
              name: String(body.name || 'checkpoint.safetensors'),
              contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
            });
            if (isSignedLocalTransferStore(this.store.blobStore)) {
              const parsed = new URL(resPresign.uploadUrl);
              resPresign.uploadUrl = `${baseOrigin}${parsed.pathname}${parsed.search}`;
            }
            this.sendJson(req, res, 200, resPresign);
            return;
          }

          if (tbParts[4] === 'checkpoints:finalize' && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const out = await this.store.finalizeCheckpointUpload(ctx, wsId, runSlug, {
              checkpointId: String(body.checkpointId || ''),
              objectKey: String(body.objectKey || ''),
              name: String(body.name || 'checkpoint.safetensors'),
              step: typeof body.step === 'number' ? body.step : undefined,
              epoch: typeof body.epoch === 'number' ? body.epoch : undefined,
              format: typeof body.format === 'string' ? body.format : undefined,
              metrics:
                body.metrics && typeof body.metrics === 'object'
                  ? (body.metrics as Record<string, number>)
                  : undefined,
              metadata:
                body.metadata && typeof body.metadata === 'object'
                  ? (body.metadata as Record<string, unknown>)
                  : undefined,
              isBest: Boolean(body.isBest),
              agent: typeof body.agent === 'string' ? body.agent : undefined,
              summary: typeof body.summary === 'string' ? body.summary : undefined,
            });
            this.sendJson(req, res, 201, { ...out, ...buildLinks(out.artifact.slug) });
            return;
          }

          if (tbParts[4] === 'checkpoints' && tbParts.length === 5 && req.method === 'GET') {
            const checkpoints = await this.store.getModelCheckpoints(ctx, wsId, runSlug);
            this.sendJson(req, res, 200, { checkpoints });
            return;
          }

          if (tbParts[4] === 'checkpoints' && tbParts.length === 5 && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const contentBuf =
              typeof body.contentBase64 === 'string'
                ? Buffer.from(body.contentBase64, 'base64')
                : typeof body.content === 'string'
                ? body.content
                : undefined;
            const out = await this.store.saveModelCheckpoint(ctx, wsId, {
              slug: runSlug,
              title: typeof body.title === 'string' ? body.title : undefined,
              name: typeof body.name === 'string' ? body.name : undefined,
              step: typeof body.step === 'number' ? body.step : undefined,
              epoch: typeof body.epoch === 'number' ? body.epoch : undefined,
              content: contentBuf,
              format: typeof body.format === 'string' ? body.format : undefined,
              metrics:
                body.metrics && typeof body.metrics === 'object'
                  ? (body.metrics as Record<string, number>)
                  : undefined,
              metadata:
                body.metadata && typeof body.metadata === 'object'
                  ? (body.metadata as Record<string, unknown>)
                  : undefined,
              isBest: Boolean(body.isBest),
              agent: typeof body.agent === 'string' ? body.agent : ctx.viaAgent,
              summary: typeof body.summary === 'string' ? body.summary : undefined,
            });
            this.sendJson(req, res, 201, { ...out, ...buildLinks(out.artifact.slug) });
            return;
          }

          if (
            tbParts[4] === 'checkpoints' &&
            tbParts[5] &&
            tbParts[6] === 'download' &&
            req.method === 'GET'
          ) {
            const dl = await this.store.getCheckpointDownloadUrl(
              ctx,
              wsId,
              safeDecodeURIComponent(tbParts[5])
            );
            if (!dl) {
              this.sendJson(req, res, 404, { error: 'Checkpoint not found' });
              return;
            }
            let downloadUrl = dl.url;
            if (isSignedLocalTransferStore(this.store.blobStore)) {
              const parsed = new URL(dl.url);
              downloadUrl = `${baseOrigin}${parsed.pathname}${parsed.search}`;
            }
            res.writeHead(302, { Location: downloadUrl });
            res.end();
            return;
          }
        }

        // Match /api/artifacts/:id/...
        const parts = apiPath.split('/').filter(Boolean);
        if (parts[0] === 'api' && parts[1] === 'artifacts' && parts[2]) {
          const idOrSlug = safeDecodeURIComponent(parts[2]);

          if (parts.length === 3 && req.method === 'GET') {
            const artifact = await this.store.getArtifact(ctx, wsId, idOrSlug);
            if (!artifact) {
              this.sendJson(req, res, 404, { error: 'Artifact not found' });
              return;
            }
            const storageEntries = await this.store.getAllStorageEntries(ctx, wsId, artifact.id);
            this.sendJson(req, res, 200, {
              artifact,
              storage: storageEntries,
              effectiveRole: artifact.effectiveRole,
              ...buildLinks(artifact.slug),
            });
            return;
          }

          if (parts.length === 3 && req.method === 'PUT') {
            const body = await parseJsonBody(req);
            if (typeof body.content !== 'string') {
              this.sendJson(req, res, 400, { error: 'content string is required' });
              return;
            }
            const updateInput: UpdateArtifactInput = {
              title: typeof body.title === 'string' ? body.title : undefined,
              description: typeof body.description === 'string' ? body.description : undefined,
              type: typeof body.type === 'string' ? (body.type as ArtifactType) : undefined,
              language: typeof body.language === 'string' ? body.language : undefined,
              content: body.content,
              agent: typeof body.agent === 'string' ? body.agent : undefined,
              project: typeof body.project === 'string' ? body.project : undefined,
              category: typeof body.category === 'string' ? body.category : undefined,
              tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
              links: Array.isArray(body.links) ? body.links.map(String) : undefined,
              icon: typeof body.icon === 'string' ? body.icon : undefined,
              summary: typeof body.summary === 'string' ? body.summary : undefined,
            };
            const artifact = await this.store.updateArtifact(ctx, wsId, idOrSlug, updateInput);
            this.sendJson(req, res, 200, { artifact, ...buildLinks(artifact.slug) });
            return;
          }

          if (parts.length === 3 && req.method === 'DELETE') {
            const deleted = await this.store.deleteArtifact(ctx, wsId, idOrSlug);
            if (!deleted) {
              this.sendJson(req, res, 404, { error: 'Artifact not found' });
              return;
            }
            this.sendJson(req, res, 200, { deleted: true });
            return;
          }

          if (parts[3] === 'icon.svg' && req.method === 'GET') {
            const artifact = await this.store.getArtifact(ctx, wsId, idOrSlug);
            if (!artifact) {
              this.sendJson(req, res, 404, { error: 'Artifact not found' });
              return;
            }
            const svg = resolveArtifactIconSvg(artifact);
            res.writeHead(200, {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
              'X-Content-Type-Options': 'nosniff',
            });
            res.end(svg);
            return;
          }

          if (parts[3] === 'versions' && parts[4] && req.method === 'GET') {
            const versionNum = Number(parts[4]);
            const content = await this.store.getVersionContent(ctx, wsId, idOrSlug, versionNum);
            if (content === null) {
              this.sendJson(req, res, 404, { error: `Version ${versionNum} not found` });
              return;
            }
            this.sendJson(req, res, 200, { version: versionNum, content });
            return;
          }

          if (parts[3] === 'diff' && req.method === 'GET') {
            const artifact = await this.store.getArtifact(ctx, wsId, idOrSlug);
            if (!artifact) {
              this.sendJson(req, res, 404, { error: 'Artifact not found' });
              return;
            }
            const toVer = Number(url.searchParams.get('to') || artifact.currentVersion);
            const fromVer = Number(url.searchParams.get('from') || Math.max(1, toVer - 1));
            const fromContent =
              (await this.store.getVersionContent(ctx, wsId, artifact.id, fromVer)) ?? '';
            const toContent =
              (await this.store.getVersionContent(ctx, wsId, artifact.id, toVer)) ?? '';
            const patch = createTwoFilesPatch(
              `v${fromVer}`,
              `v${toVer}`,
              fromContent,
              toContent,
              '',
              '',
              { context: 4 }
            );
            this.sendJson(req, res, 200, {
              fromVersion: fromVer,
              toVersion: toVer,
              fromContent,
              toContent,
              patch,
            });
            return;
          }

          if (parts[3] === 'rollback' && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const targetVersion = Number(body.version);
            if (!targetVersion) {
              this.sendJson(req, res, 400, { error: 'version is required' });
              return;
            }
            const artifact = await this.store.rollbackArtifact(
              ctx,
              wsId,
              idOrSlug,
              targetVersion
            );
            this.sendJson(req, res, 200, { artifact });
            return;
          }

          if (parts[3] === 'export' && req.method === 'GET') {
            const artifact = await this.store.getArtifact(ctx, wsId, idOrSlug);
            if (!artifact) {
              this.sendJson(req, res, 404, { error: 'Artifact not found' });
              return;
            }
            const versionParam = url.searchParams.get('version');
            const content = versionParam
              ? (await this.store.getVersionContent(ctx, wsId, artifact.id, Number(versionParam))) ??
                artifact.content
              : artifact.content;
            const entries = await this.store.getAllStorageEntries(ctx, wsId, artifact.id);
            const initialStorage: Record<string, string> = {};
            for (const e of entries) initialStorage[e.key] = e.value;
            const html = buildSandboxHtml({
              artifactId: artifact.id,
              title: artifact.title,
              type: artifact.type,
              language: artifact.language,
              content,
              initialStorage,
              standalone: true,
            });
            const download = url.searchParams.get('download') === '1';
            const exportFilename = sanitizeContentDispositionFilename(
              `${artifact.slug}-v${versionParam || artifact.currentVersion}.html`
            );
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Security-Policy':
                "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock; default-src * 'unsafe-inline' 'unsafe-eval' blob: data:;",
              'X-Content-Type-Options': 'nosniff',
              'Referrer-Policy': 'no-referrer',
              ...(download
                ? {
                    'Content-Disposition': `attachment; filename="${exportFilename}"`,
                  }
                : {}),
            });
            res.end(html);
            return;
          }

          if (parts[3] === 'storage') {
            if (req.method === 'GET') {
              const key = url.searchParams.get('key');
              const prefix = url.searchParams.get('prefix');
              if (key !== null) {
                const result = await this.store.getStorageValue(ctx, wsId, idOrSlug, key);
                this.sendJson(req, res, 200, { result });
                return;
              }
              if (prefix !== null) {
                const result = await this.store.listStorageKeys(ctx, wsId, idOrSlug, prefix);
                this.sendJson(req, res, 200, { result });
                return;
              }
              const entries = await this.store.getAllStorageEntries(ctx, wsId, idOrSlug);
              this.sendJson(req, res, 200, { entries });
              return;
            }
            if (req.method === 'PUT' || req.method === 'POST') {
              const body = await parseJsonBody(req);
              const key = String(body.key || '');
              const value = String(body.value ?? '');
              if (!key) {
                this.sendJson(req, res, 400, { error: 'key is required' });
                return;
              }
              const result = await this.store.setStorageValue(ctx, wsId, idOrSlug, key, value);
              this.sendJson(req, res, 200, { result });
              return;
            }
            if (req.method === 'DELETE') {
              const key = url.searchParams.get('key');
              if (key) {
                const result = await this.store.deleteStorageValue(ctx, wsId, idOrSlug, key);
                this.sendJson(req, res, 200, { result });
                return;
              }
              await this.store.clearStorage(ctx, wsId, idOrSlug);
              this.sendJson(req, res, 200, { cleared: true });
              return;
            }
          }
        }

        this.sendJson(req, res, 404, { error: 'API route not found' });
        return;
      }

      // Serve built static SPA files for UI routes (/, /artifacts/:slug, /s/:token, /auth/cli/authorize, /auth/device)
      if (this.publicDir && (req.method === 'GET' || req.method === 'HEAD')) {
        let decodedPathname: string;
        try {
          decodedPathname = decodeURIComponent(pathname);
        } catch {
          this.sendJson(req, res, 400, { error: 'Invalid URL encoding' });
          return;
        }
        if (decodedPathname.includes('\0')) {
          this.sendJson(req, res, 400, { error: 'Invalid path' });
          return;
        }
        const publicRoot = path.resolve(this.publicDir);
        const targetRel = decodedPathname === '/' ? '/index.html' : decodedPathname;
        let filePath = path.resolve(publicRoot, '.' + targetRel);
        if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
          this.sendJson(req, res, 403, { error: 'Forbidden' });
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(publicRoot, 'index.html');
        }
        if (fs.existsSync(filePath)) {
          const realRoot = fs.realpathSync(publicRoot);
          const realFile = fs.realpathSync(filePath);
          if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
            this.sendJson(req, res, 403, { error: 'Forbidden' });
            return;
          }
          const ext = path.extname(realFile).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
            ...(this.isSecureRequest(req)
              ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
              : {}),
          });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            fs.createReadStream(realFile).pipe(res);
          }
          return;
        }
      }

      // Fallback minimal HTML if web bundle hasn't been built (useful in headless tests)
      if (pathname === '/auth/cli/authorize' || pathname === '/auth/device') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          ...(this.isSecureRequest(req)
            ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
            : {}),
        });
        res.end('<!DOCTYPE html><html><body><h1>MyArtifact Cloud CLI Authorization</h1></body></html>');
        return;
      }

      this.sendJson(req, res, 404, { error: 'Not found' });
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof CloudPermissionError) {
        this.sendJson(req, res, err.statusCode, { error: err.message, code: err.code });
        return;
      }
      if (err instanceof HttpBadRequestError || err instanceof SyntaxError) {
        this.sendJson(req, res, 400, { error: err.message || 'Bad request' });
        return;
      }
      const message =
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err instanceof Error
            ? err.message
            : String(err);
      this.sendJson(req, res, 500, { error: message });
    }
  }

  public close(): void {
    this.unsubscribePubSub?.();
    this.unsubscribePubSub = null;
    for (const c of this.wsClients) {
      c.ws.terminate();
    }
    this.wsClients.clear();
  }
}
