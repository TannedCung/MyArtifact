import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createTwoFilesPatch } from 'diff';
import { ArtifactStore, getDefaultDataDir } from '../core/storage.js';
import { MYARTIFACT_LOGO_SVG, resolveArtifactIconSvg } from '../core/icons.js';
import { buildSandboxHtml } from '../core/sandbox-template.js';
import { startArtifactWatcher } from './watcher.js';
import { createBlobStoreFromEnv, hasS3EnvConfig } from '../cloud/blob-store.js';
import { CloudTokenService } from '../cloud/auth/jwt.js';
import type { GoogleOidcVerifier } from '../cloud/auth/google-oidc.js';
import { CloudHttpRuntime } from '../cloud/cloud-server.js';
import { SqliteCloudStore } from '../cloud/sqlite-cloud-store.js';
import { PostgresCloudStore } from '../cloud/postgres-store.js';
import type { CloudStore } from '../cloud/store-interface.js';
import type {
  ArtifactType,
  CreateArtifactInput,
  TensorBoardScalarPoint,
  UpdateArtifactInput,
} from '../core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CloudServerConfig {
  cloudStore?: CloudStore;
  tokenService?: CloudTokenService;
  oidcVerifier?: GoogleOidcVerifier | null;
  publicBaseUrl?: string;
  dataDir?: string;
  allowedOrigins?: string[];
}

export interface ServerOptions {
  port?: number;
  host?: string;
  mode?: 'local' | 'cloud';
  store?: ArtifactStore;
  watchDirs?: string[];
  enableWatcher?: boolean;
  cloud?: CloudServerConfig;
  allowedOrigins?: string[];
}

export interface RunningArtifactServer {
  server: http.Server;
  store: ArtifactStore;
  cloudStore?: CloudStore;
  mode: 'local' | 'cloud';
  port: number;
  host: string;
  broadcast: (event: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

const MAX_JSON_BODY_BYTES = 50 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'PayloadTooLargeError';
  }
}

class BadJsonBodyError extends Error {
  constructor(message = 'Invalid JSON request body') {
    super(message);
    this.name = 'BadJsonBodyError';
  }
}

export function isAllowedLocalOrigin(
  origin: string | undefined,
  allowedOrigins?: string[]
): boolean {
  if (origin === undefined) return true;
  const trimmed = origin.trim();
  if (!trimmed || trimmed === 'null') return false;
  if (allowedOrigins && allowedOrigins.includes(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.origin !== trimmed) return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}

function isLoopbackHostAddress(host: string): boolean {
  const norm = host.trim().toLowerCase();
  return norm === '127.0.0.1' || norm === 'localhost' || norm === '::1' || norm === '[::1]';
}

function isValidLoopbackHostHeader(hostHeader: string): boolean {
  const trimmed = hostHeader.trim();
  if (!trimmed || /[\s/?#@\\]/.test(trimmed)) return false;
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(`http://${trimmed}`);
    const h = parsed.hostname.toLowerCase();
    return (
      (h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function isPathWithinDir(targetPath: string, rootDir: string): boolean {
  if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
    return false;
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return false;
  }
  try {
    const realRoot = fs.existsSync(resolvedRoot)
      ? fs.realpathSync(resolvedRoot)
      : resolvedRoot;
    if (fs.existsSync(resolvedTarget)) {
      const realTarget = fs.realpathSync(resolvedTarget);
      return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
    }
    let cur = path.dirname(resolvedTarget);
    while (cur && cur !== path.dirname(cur) && !fs.existsSync(cur)) {
      cur = path.dirname(cur);
    }
    if (fs.existsSync(cur)) {
      const realAncestor = fs.realpathSync(cur);
      return realAncestor === realRoot || realAncestor.startsWith(realRoot + path.sep);
    }
  } catch {
    return false;
  }
  return true;
}

function sanitizeDispositionFilename(name: string): string {
  return name.replace(/[\r\n"\\/\x00-\x1f]/g, '_');
}

function buildLocalCorsHeaders(
  origin: string | undefined,
  allowedOrigins?: string[]
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin !== undefined && isAllowedLocalOrigin(origin, allowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader !== undefined) {
      const declaredLength = Number(contentLengthHeader);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
        req.pause();
        reject(new PayloadTooLargeError());
        return;
      }
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        req.pause();
        fail(new PayloadTooLargeError());
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          settled = true;
          resolve({});
          return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          fail(new BadJsonBodyError('JSON request body must be an object'));
          return;
        }
        settled = true;
        resolve(parsed as Record<string, unknown>);
      } catch (err) {
        fail(err instanceof Error ? err : new BadJsonBodyError());
      }
    });
    req.on('error', (err) => fail(err));
  });
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

export async function startArtifactServer(
  options: ServerOptions = {}
): Promise<RunningArtifactServer> {
  const host = options.host || process.env.MYARTIFACT_HOST || '127.0.0.1';
  const requestedPort = options.port ?? Number(process.env.MYARTIFACT_PORT || 4173);
  const mode: 'local' | 'cloud' =
    options.mode ||
    (options.cloud ? 'cloud' : undefined) ||
    (process.env.MYARTIFACT_MODE === 'cloud' ? 'cloud' : 'local');

  // Locate static web build directory
  const candidatePublicDirs = [
    path.resolve(__dirname, '../dist/public'),
    path.resolve(__dirname, './public'),
    path.resolve(process.cwd(), 'dist/public'),
  ];
  const publicDir = candidatePublicDirs.find((d) => fs.existsSync(d));

  if (mode === 'cloud') {
    const dataDir = path.resolve(options.cloud?.dataDir || getDefaultDataDir());
    let cloudStore = options.cloud?.cloudStore;
    let ownsCloudStore = false;
    let isPostgres = false;
    if (!cloudStore) {
      ownsCloudStore = true;
      const dbUrl = process.env.DATABASE_URL;
      isPostgres = Boolean(
        dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))
      );
      cloudStore = isPostgres
        ? await PostgresCloudStore.connect(
            dbUrl!,
            hasS3EnvConfig() ? createBlobStoreFromEnv(dataDir) : undefined
          )
        : new SqliteCloudStore(dataDir, createBlobStoreFromEnv(dataDir));
    }

    const tokenService =
      options.cloud?.tokenService ||
      new CloudTokenService({ dataDir: isPostgres ? undefined : dataDir });
    const runtime = new CloudHttpRuntime({
      store: cloudStore,
      tokenService,
      oidcVerifier: options.cloud?.oidcVerifier,
      publicBaseUrl: options.cloud?.publicBaseUrl || process.env.MYARTIFACT_PUBLIC_URL,
      publicDir,
      allowedOrigins: options.cloud?.allowedOrigins,
    });

    const server = http.createServer((req, res) => {
      void runtime.handleRequest(req, res);
    });
    const wss = runtime.attachWebSocketServer(server);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, host, () => resolve());
    });

    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
    if (!options.cloud?.publicBaseUrl && !process.env.MYARTIFACT_PUBLIC_URL) {
      runtime.setPublicBaseUrl(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`);
    }

    const placeholderStore = options.store as ArtifactStore;
    return {
      server,
      store: placeholderStore,
      cloudStore,
      mode: 'cloud',
      port: actualPort,
      host,
      broadcast: () => {},
      close: async () => {
        runtime.close();
        wss.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (ownsCloudStore) {
          await cloudStore!.close();
        }
      },
    };
  }

  const store = options.store || new ArtifactStore();

  const clients = new Set<WebSocket>();
  const broadcast = (payload: Record<string, unknown>) => {
    const msg = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  };

  const watcher =
    options.enableWatcher !== false
      ? startArtifactWatcher(store, options.watchDirs || [], {
          onArtifactUpserted: (artifact, sourcePath) => {
            broadcast({
              type: 'artifact:updated',
              artifact,
              sourcePath,
            });
          },
        })
      : null;

  const allowedOrigins = options.allowedOrigins || options.cloud?.allowedOrigins;
  const isLoopbackHost = isLoopbackHostAddress(host);
  const respondJson = (
    res: http.ServerResponse,
    status: number,
    data: unknown,
    origin?: string
  ): void => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...buildLocalCorsHeaders(origin, allowedOrigins),
    });
    res.end(JSON.stringify(data));
  };

  const server = http.createServer(async (req, res) => {
    const reqOrigin = req.headers.origin;
    try {
      if (
        isLoopbackHost &&
        req.headers.host !== undefined &&
        !isValidLoopbackHostHeader(req.headers.host)
      ) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid Host header' }));
        return;
      }

      if (reqOrigin !== undefined && !isAllowedLocalOrigin(reqOrigin, allowedOrigins)) {
        res.writeHead(403, {
          'Content-Type': 'application/json; charset=utf-8',
          Vary: 'Origin',
        });
        res.end(JSON.stringify({ error: 'Cross-origin request blocked' }));
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, buildLocalCorsHeaders(reqOrigin, allowedOrigins));
        res.end();
        return;
      }

      const safeHostForUrl =
        req.headers.host &&
        /^(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::\d{1,5})?$/.test(req.headers.host.trim())
          ? req.headers.host.trim()
          : `${host === '0.0.0.0' ? '127.0.0.1' : host}:${requestedPort}`;
      const url = new URL(req.url || '/', `http://${safeHostForUrl}`);
      const pathname = url.pathname;
      const baseOrigin = `http://${safeHostForUrl}`;
      const buildArtifactLinks = (slug: string) => ({
        url: `${baseOrigin}/artifacts/${encodeURIComponent(slug)}`,
        previewUrl: `${baseOrigin}/artifacts/${encodeURIComponent(slug)}`,
        studioUrl: `${baseOrigin}/?view=studio&artifact=${encodeURIComponent(slug)}`,
      });

      // Brand Favicon SVG
      if (pathname === '/favicon.svg' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff',
          ...buildLocalCorsHeaders(reqOrigin, allowedOrigins),
        });
        res.end(MYARTIFACT_LOGO_SVG);
        return;
      }

      // Health & Info
      if (pathname === '/api/health' && req.method === 'GET') {
        respondJson(
          res,
          200,
          {
            ok: true,
            mode: 'local',
            dataDir: store.dataDir,
            dropzoneDir: store.dropzoneDir,
            artifactsDir: store.artifactsDir,
            runsDir: store.runsDir,
          },
          reqOrigin
        );
        return;
      }

      if (pathname === '/api/auth/providers' && req.method === 'GET') {
        respondJson(
          res,
          200,
          {
            mode: 'local',
            googleEnabled: false,
            allowDeviceFlow: false,
            realtimeWs: true,
          },
          reqOrigin
        );
        return;
      }

      // ======================================================================
      // TensorBoard & Model Checkpoints API (/api/tensorboard/...)
      // ======================================================================
      if (pathname === '/api/tensorboard/runs' && req.method === 'GET') {
        const runs = store.listArtifacts({ type: 'tensorboard' }).map((r) => ({
          ...r,
          checkpoints: store.getModelCheckpoints(r.id),
        }));
        respondJson(res, 200, { runs, runsDir: store.runsDir }, reqOrigin);
        return;
      }

      if (pathname === '/api/tensorboard/import' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.filePath || typeof body.filePath !== 'string') {
          respondJson(res, 400, { error: 'filePath is required' }, reqOrigin);
          return;
        }
        if (!isPathWithinDir(body.filePath, store.dataDir)) {
          respondJson(
            res,
            403,
            {
              error:
                'File path over HTTP must reside within MyArtifact data directory; use local CLI for external paths',
            },
            reqOrigin
          );
          return;
        }
        const artifact = store.importTfEventsFile(body.filePath, {
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          agent: typeof body.agent === 'string' ? body.agent : undefined,
          project: typeof body.project === 'string' ? body.project : undefined,
        });
        broadcast({ type: 'artifact:updated', artifact });
        respondJson(res, 200, { artifact, ...buildArtifactLinks(artifact.slug) }, reqOrigin);
        return;
      }

      const tbParts = pathname.split('/').filter(Boolean);
      if (tbParts[0] === 'api' && tbParts[1] === 'tensorboard' && tbParts[2] === 'runs' && tbParts[3]) {
        const runSlug = decodeURIComponent(tbParts[3]);

        // POST /api/tensorboard/runs/:slug/scalars
        if (tbParts[4] === 'scalars' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const artifact = store.logTensorBoardScalars({
            slug: runSlug,
            title: typeof body.title === 'string' ? body.title : undefined,
            experiment: typeof body.experiment === 'string' ? body.experiment : undefined,
            modelName: typeof body.modelName === 'string' ? body.modelName : undefined,
            framework: typeof body.framework === 'string' ? body.framework : undefined,
            status:
              body.status === 'running' || body.status === 'completed' || body.status === 'failed'
                ? body.status
                : undefined,
            agent: typeof body.agent === 'string' ? body.agent : undefined,
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
          broadcast({ type: 'artifact:updated', artifact });
          respondJson(res, 200, { artifact, ...buildArtifactLinks(artifact.slug) }, reqOrigin);
          return;
        }

        // GET /api/tensorboard/runs/:slug/checkpoints
        if (tbParts[4] === 'checkpoints' && tbParts.length === 5 && req.method === 'GET') {
          const checkpoints = store.getModelCheckpoints(runSlug);
          respondJson(res, 200, { checkpoints }, reqOrigin);
          return;
        }

        // POST /api/tensorboard/runs/:slug/checkpoints
        if (tbParts[4] === 'checkpoints' && tbParts.length === 5 && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (
            body.sourceFilePath !== undefined &&
            body.sourceFilePath !== '' &&
            (typeof body.sourceFilePath !== 'string' ||
              !isPathWithinDir(body.sourceFilePath, store.dataDir))
          ) {
            respondJson(
              res,
              403,
              {
                error:
                  'File path over HTTP must reside within MyArtifact data directory; use local CLI for external paths',
              },
              reqOrigin
            );
            return;
          }
          const contentBuf =
            typeof body.contentBase64 === 'string'
              ? Buffer.from(body.contentBase64, 'base64')
              : typeof body.content === 'string'
              ? body.content
              : undefined;

          const { artifact, checkpoint } = store.saveModelCheckpoint({
            slug: runSlug,
            title: typeof body.title === 'string' ? body.title : undefined,
            name: typeof body.name === 'string' ? body.name : undefined,
            step: typeof body.step === 'number' ? body.step : undefined,
            epoch: typeof body.epoch === 'number' ? body.epoch : undefined,
            sourceFilePath:
              typeof body.sourceFilePath === 'string' ? body.sourceFilePath : undefined,
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
            agent: typeof body.agent === 'string' ? body.agent : undefined,
            summary: typeof body.summary === 'string' ? body.summary : undefined,
          });

          broadcast({ type: 'artifact:updated', artifact });
          respondJson(
            res,
            201,
            { artifact, checkpoint, ...buildArtifactLinks(artifact.slug) },
            reqOrigin
          );
          return;
        }

        // GET /api/tensorboard/runs/:slug/checkpoints/:id/download
        if (
          tbParts[4] === 'checkpoints' &&
          tbParts[5] &&
          tbParts[6] === 'download' &&
          req.method === 'GET'
        ) {
          const ckpt = store.getModelCheckpointById(decodeURIComponent(tbParts[5]));
          if (!ckpt || !fs.existsSync(ckpt.filePath)) {
            respondJson(res, 404, { error: 'Model checkpoint file not found' }, reqOrigin);
            return;
          }
          const safeCkptFilename = sanitizeDispositionFilename(ckpt.name || 'checkpoint.bin');
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeCkptFilename}"`,
            'X-Content-Type-Options': 'nosniff',
            ...buildLocalCorsHeaders(reqOrigin, allowedOrigins),
          });
          fs.createReadStream(ckpt.filePath).pipe(res);
          return;
        }
      }

      // Broadcast hook (used by CLI or MCP server to notify live browser sessions)
      if (pathname === '/api/notify' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        broadcast(body);
        respondJson(res, 200, { ok: true }, reqOrigin);
        return;
      }

      // GET /api/wiki (Karpathy LLM Wiki index.md + log.md + projects + categories + backlinks)
      if (pathname === '/api/wiki' && req.method === 'GET') {
        const projFilter = url.searchParams.get('project') || undefined;
        const taxonomy = store.getWikiTaxonomy(projFilter);
        const indexMarkdown = store.getWikiIndexMarkdown(projFilter);
        const logMarkdown = store.getWikiLogMarkdown();
        respondJson(
          res,
          200,
          {
            ...taxonomy,
            indexMarkdown,
            logMarkdown,
          },
          reqOrigin
        );
        return;
      }

      // GET /api/artifacts
      if (pathname === '/api/artifacts' && req.method === 'GET') {
        const artifacts = store.listArtifacts({
          query: url.searchParams.get('q') || undefined,
          agent: url.searchParams.get('agent') || undefined,
          type: (url.searchParams.get('type') as ArtifactType) || undefined,
          project: url.searchParams.get('project') || undefined,
          category: url.searchParams.get('category') || undefined,
          tag: url.searchParams.get('tag') || undefined,
          limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        });
        respondJson(res, 200, { artifacts }, reqOrigin);
        return;
      }

      // POST /api/artifacts (supports upsert if body.upsert === true and slug provided)
      if (pathname === '/api/artifacts' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.content || typeof body.content !== 'string') {
          respondJson(res, 400, { error: 'content is required' }, reqOrigin);
          return;
        }
        const input: CreateArtifactInput = {
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          title: typeof body.title === 'string' && body.title ? body.title : 'Untitled Artifact',
          description: typeof body.description === 'string' ? body.description : undefined,
          type: typeof body.type === 'string' ? (body.type as ArtifactType) : undefined,
          language: typeof body.language === 'string' ? body.language : undefined,
          content: body.content,
          agent: typeof body.agent === 'string' ? body.agent : 'user',
          project: typeof body.project === 'string' ? body.project : 'default',
          category: typeof body.category === 'string' ? body.category : undefined,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
          links: Array.isArray(body.links) ? body.links.map(String) : undefined,
          icon: typeof body.icon === 'string' ? body.icon : undefined,
          summary: typeof body.summary === 'string' ? body.summary : undefined,
        };

        const artifact =
          body.upsert && input.slug
            ? store.upsertBySlug(input.slug, input)
            : store.createArtifact(input);

        broadcast({ type: 'artifact:created', artifact });
        respondJson(res, 201, { artifact, ...buildArtifactLinks(artifact.slug) }, reqOrigin);
        return;
      }

      // Match /api/artifacts/:id/...
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0] === 'api' && parts[1] === 'artifacts' && parts[2]) {
        const idOrSlug = decodeURIComponent(parts[2]);

        // GET /api/artifacts/:id
        if (parts.length === 3 && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            respondJson(res, 404, { error: 'Artifact not found' }, reqOrigin);
            return;
          }
          const storageEntries = store.getAllStorageEntries(artifact.id);
          respondJson(
            res,
            200,
            {
              artifact,
              storage: storageEntries,
              ...buildArtifactLinks(artifact.slug),
            },
            reqOrigin
          );
          return;
        }

        // PUT /api/artifacts/:id
        if (parts.length === 3 && req.method === 'PUT') {
          const body = await parseJsonBody(req);
          if (typeof body.content !== 'string') {
            respondJson(res, 400, { error: 'content string is required' }, reqOrigin);
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
          const artifact = store.updateArtifact(idOrSlug, updateInput);
          broadcast({ type: 'artifact:updated', artifact });
          respondJson(res, 200, { artifact, ...buildArtifactLinks(artifact.slug) }, reqOrigin);
          return;
        }

        // GET /api/artifacts/:id/icon.svg
        if (parts[3] === 'icon.svg' && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            respondJson(res, 404, { error: 'Artifact not found' }, reqOrigin);
            return;
          }
          const svg = resolveArtifactIconSvg(artifact);
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'X-Content-Type-Options': 'nosniff',
            ...buildLocalCorsHeaders(reqOrigin, allowedOrigins),
          });
          res.end(svg);
          return;
        }

        // DELETE /api/artifacts/:id
        if (parts.length === 3 && req.method === 'DELETE') {
          const deleted = store.deleteArtifact(idOrSlug);
          if (!deleted) {
            respondJson(res, 404, { error: 'Artifact not found' }, reqOrigin);
            return;
          }
          broadcast({ type: 'artifact:deleted', id: idOrSlug });
          respondJson(res, 200, { deleted: true }, reqOrigin);
          return;
        }

        // GET /api/artifacts/:id/versions/:version
        if (parts[3] === 'versions' && parts[4] && req.method === 'GET') {
          const versionNum = Number(parts[4]);
          const content = store.getVersionContent(idOrSlug, versionNum);
          if (content === null) {
            respondJson(res, 404, { error: `Version ${versionNum} not found` }, reqOrigin);
            return;
          }
          respondJson(res, 200, { version: versionNum, content }, reqOrigin);
          return;
        }

        // GET /api/artifacts/:id/diff?from=1&to=2
        if (parts[3] === 'diff' && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            respondJson(res, 404, { error: 'Artifact not found' }, reqOrigin);
            return;
          }
          const toVer = Number(url.searchParams.get('to') || artifact.currentVersion);
          const fromVer = Number(url.searchParams.get('from') || Math.max(1, toVer - 1));
          const fromContent = store.getVersionContent(artifact.id, fromVer) ?? '';
          const toContent = store.getVersionContent(artifact.id, toVer) ?? '';
          const patch = createTwoFilesPatch(
            `v${fromVer}`,
            `v${toVer}`,
            fromContent,
            toContent,
            '',
            '',
            { context: 4 }
          );
          respondJson(
            res,
            200,
            {
              fromVersion: fromVer,
              toVersion: toVer,
              fromContent,
              toContent,
              patch,
            },
            reqOrigin
          );
          return;
        }

        // POST /api/artifacts/:id/rollback
        if (parts[3] === 'rollback' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const targetVersion = Number(body.version);
          if (!targetVersion) {
            respondJson(res, 400, { error: 'version is required' }, reqOrigin);
            return;
          }
          const artifact = store.rollbackArtifact(
            idOrSlug,
            targetVersion,
            typeof body.agent === 'string' ? body.agent : 'user'
          );
          broadcast({ type: 'artifact:updated', artifact });
          respondJson(res, 200, { artifact }, reqOrigin);
          return;
        }

        // GET /api/artifacts/:id/export
        if (parts[3] === 'export' && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            respondJson(res, 404, { error: 'Artifact not found' }, reqOrigin);
            return;
          }
          const versionParam = url.searchParams.get('version');
          const content = versionParam
            ? store.getVersionContent(artifact.id, Number(versionParam)) ?? artifact.content
            : artifact.content;

          const entries = store.getAllStorageEntries(artifact.id);
          const initialStorage: Record<string, string> = {};
          for (const entry of entries) {
            initialStorage[entry.key] = entry.value;
          }

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
          const safeExportFilename = sanitizeDispositionFilename(
            `${artifact.slug}-v${versionParam || artifact.currentVersion}.html`
          );
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy':
              "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock; default-src * 'unsafe-inline' 'unsafe-eval' blob: data:;",
            'X-Content-Type-Options': 'nosniff',
            ...buildLocalCorsHeaders(reqOrigin, allowedOrigins),
            ...(download
              ? {
                  'Content-Disposition': `attachment; filename="${safeExportFilename}"`,
                }
              : {}),
          });
          res.end(html);
          return;
        }

        // Storage API: /api/artifacts/:id/storage
        if (parts[3] === 'storage') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            respondJson(res, 404, { error: 'Artifact not found' }, reqOrigin);
            return;
          }

          if (req.method === 'GET') {
            const key = url.searchParams.get('key');
            const prefix = url.searchParams.get('prefix');
            if (key !== null) {
              const result = store.getStorageValue(artifact.id, key);
              respondJson(res, 200, { result }, reqOrigin);
              return;
            }
            if (prefix !== null) {
              const result = store.listStorageKeys(artifact.id, prefix);
              respondJson(res, 200, { result }, reqOrigin);
              return;
            }
            const entries = store.getAllStorageEntries(artifact.id);
            respondJson(res, 200, { entries }, reqOrigin);
            return;
          }

          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await parseJsonBody(req);
            const key = String(body.key || '');
            const value = String(body.value ?? '');
            if (!key) {
              respondJson(res, 400, { error: 'key is required' }, reqOrigin);
              return;
            }
            const result = store.setStorageValue(artifact.id, key, value);
            broadcast({
              type: 'storage:updated',
              artifactId: artifact.id,
              entries: store.getAllStorageEntries(artifact.id),
            });
            respondJson(res, 200, { result }, reqOrigin);
            return;
          }

          if (req.method === 'DELETE') {
            const key = url.searchParams.get('key');
            if (key) {
              const result = store.deleteStorageValue(artifact.id, key);
              broadcast({
                type: 'storage:updated',
                artifactId: artifact.id,
                entries: store.getAllStorageEntries(artifact.id),
              });
              respondJson(res, 200, { result }, reqOrigin);
              return;
            }
            store.clearStorage(artifact.id);
            broadcast({
              type: 'storage:updated',
              artifactId: artifact.id,
              entries: [],
            });
            respondJson(res, 200, { cleared: true }, reqOrigin);
            return;
          }
        }
      }

      // Serve static frontend files if built
      if (publicDir) {
        let decodedPathname: string;
        try {
          decodedPathname = decodeURIComponent(pathname);
        } catch {
          respondJson(res, 400, { error: 'Invalid URL encoding' }, reqOrigin);
          return;
        }
        if (decodedPathname.includes('\0')) {
          respondJson(res, 400, { error: 'Invalid path' }, reqOrigin);
          return;
        }
        const publicRoot = path.resolve(publicDir);
        const realPublicRoot = fs.existsSync(publicRoot) ? fs.realpathSync(publicRoot) : publicRoot;
        const relPath = decodedPathname === '/' ? '/index.html' : decodedPathname;
        let filePath = path.resolve(
          publicRoot,
          '.' + (relPath.startsWith('/') ? relPath : '/' + relPath)
        );
        if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
          respondJson(res, 403, { error: 'Forbidden' }, reqOrigin);
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(publicRoot, 'index.html');
        }
        if (fs.existsSync(filePath)) {
          const realFilePath = fs.realpathSync(filePath);
          if (realFilePath !== realPublicRoot && !realFilePath.startsWith(realPublicRoot + path.sep)) {
            respondJson(res, 403, { error: 'Forbidden' }, reqOrigin);
            return;
          }
          const ext = path.extname(realFilePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          });
          fs.createReadStream(realFilePath).pipe(res);
          return;
        }
      }

      respondJson(res, 404, { error: 'Not found' }, reqOrigin);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        if (!res.headersSent) {
          res.writeHead(413, {
            ...buildLocalCorsHeaders(reqOrigin, allowedOrigins),
            'Content-Type': 'application/json; charset=utf-8',
            Connection: 'close',
          });
          res.end(JSON.stringify({ error: 'Request body too large' }), () => {
            req.destroy();
          });
        } else {
          req.destroy();
        }
        return;
      }
      if (err instanceof SyntaxError || err instanceof BadJsonBodyError) {
        respondJson(res, 400, { error: 'Invalid JSON request body' }, reqOrigin);
        return;
      }
      if (err instanceof URIError) {
        respondJson(res, 400, { error: 'Invalid URL encoding' }, reqOrigin);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      respondJson(res, 500, { error: message }, reqOrigin);
    }
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, done) => {
      const req = info.req;
      if (
        isLoopbackHost &&
        req.headers.host !== undefined &&
        !isValidLoopbackHostHeader(req.headers.host)
      ) {
        done(false, 403, 'Invalid Host header');
        return;
      }
      if (!isAllowedLocalOrigin(req.headers.origin, allowedOrigins)) {
        done(false, 403, 'Cross-origin request blocked');
        return;
      }
      done(true);
    },
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('error', () => clients.delete(ws));
    ws.on('close', () => clients.delete(ws));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;

  return {
    server,
    store,
    mode: 'local',
    port: actualPort,
    host,
    broadcast,
    close: async () => {
      if (watcher) {
        await watcher.close();
      }
      for (const client of clients) {
        client.terminate();
      }
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
