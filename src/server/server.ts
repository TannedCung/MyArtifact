import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createTwoFilesPatch } from 'diff';
import { ArtifactStore } from '../core/storage.js';
import { MYARTIFACT_LOGO_SVG, resolveArtifactIconSvg } from '../core/icons.js';
import { buildSandboxHtml } from '../core/sandbox-template.js';
import { startArtifactWatcher } from './watcher.js';
import type {
  ArtifactType,
  CreateArtifactInput,
  TensorBoardScalarPoint,
  UpdateArtifactInput,
} from '../core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  port?: number;
  host?: string;
  store?: ArtifactStore;
  watchDirs?: string[];
  enableWatcher?: boolean;
}

export interface RunningArtifactServer {
  server: http.Server;
  store: ArtifactStore;
  port: number;
  host: string;
  broadcast: (event: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function startArtifactServer(
  options: ServerOptions = {}
): Promise<RunningArtifactServer> {
  const store = options.store || new ArtifactStore();
  const host = options.host || process.env.MYARTIFACT_HOST || '127.0.0.1';
  const requestedPort = options.port ?? Number(process.env.MYARTIFACT_PORT || 4173);

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

  // Locate static web build directory
  const candidatePublicDirs = [
    path.resolve(__dirname, '../dist/public'),
    path.resolve(__dirname, './public'),
    path.resolve(process.cwd(), 'dist/public'),
  ];
  const publicDir = candidatePublicDirs.find((d) => fs.existsSync(d));

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const baseOrigin = `http://${req.headers.host || `${host}:${requestedPort}`}`;
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
        });
        res.end(MYARTIFACT_LOGO_SVG);
        return;
      }

      // Health & Info
      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          dataDir: store.dataDir,
          dropzoneDir: store.dropzoneDir,
          artifactsDir: store.artifactsDir,
          runsDir: store.runsDir,
        });
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
        sendJson(res, 200, { runs, runsDir: store.runsDir });
        return;
      }

      if (pathname === '/api/tensorboard/import' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.filePath || typeof body.filePath !== 'string') {
          sendJson(res, 400, { error: 'filePath is required' });
          return;
        }
        const artifact = store.importTfEventsFile(body.filePath, {
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          agent: typeof body.agent === 'string' ? body.agent : undefined,
          project: typeof body.project === 'string' ? body.project : undefined,
        });
        broadcast({ type: 'artifact:updated', artifact });
        sendJson(res, 200, { artifact, ...buildArtifactLinks(artifact.slug) });
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
          sendJson(res, 200, { artifact, ...buildArtifactLinks(artifact.slug) });
          return;
        }

        // GET /api/tensorboard/runs/:slug/checkpoints
        if (tbParts[4] === 'checkpoints' && tbParts.length === 5 && req.method === 'GET') {
          const checkpoints = store.getModelCheckpoints(runSlug);
          sendJson(res, 200, { checkpoints });
          return;
        }

        // POST /api/tensorboard/runs/:slug/checkpoints
        if (tbParts[4] === 'checkpoints' && tbParts.length === 5 && req.method === 'POST') {
          const body = await parseJsonBody(req);
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
          sendJson(res, 201, { artifact, checkpoint, ...buildArtifactLinks(artifact.slug) });
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
            sendJson(res, 404, { error: 'Model checkpoint file not found' });
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${ckpt.name}"`,
          });
          fs.createReadStream(ckpt.filePath).pipe(res);
          return;
        }
      }

      // Broadcast hook (used by CLI or MCP server to notify live browser sessions)
      if (pathname === '/api/notify' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        broadcast(body);
        sendJson(res, 200, { ok: true });
        return;
      }

      // GET /api/wiki (Karpathy LLM Wiki index.md + log.md + projects + categories + backlinks)
      if (pathname === '/api/wiki' && req.method === 'GET') {
        const projFilter = url.searchParams.get('project') || undefined;
        const taxonomy = store.getWikiTaxonomy(projFilter);
        const indexMarkdown = store.getWikiIndexMarkdown(projFilter);
        const logMarkdown = store.getWikiLogMarkdown();
        sendJson(res, 200, {
          ...taxonomy,
          indexMarkdown,
          logMarkdown,
        });
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
        sendJson(res, 200, { artifacts });
        return;
      }

      // POST /api/artifacts (supports upsert if body.upsert === true and slug provided)
      if (pathname === '/api/artifacts' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.content || typeof body.content !== 'string') {
          sendJson(res, 400, { error: 'content is required' });
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
        sendJson(res, 201, { artifact, ...buildArtifactLinks(artifact.slug) });
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
            sendJson(res, 404, { error: 'Artifact not found' });
            return;
          }
          const storageEntries = store.getAllStorageEntries(artifact.id);
          sendJson(res, 200, {
            artifact,
            storage: storageEntries,
            ...buildArtifactLinks(artifact.slug),
          });
          return;
        }

        // PUT /api/artifacts/:id
        if (parts.length === 3 && req.method === 'PUT') {
          const body = await parseJsonBody(req);
          if (typeof body.content !== 'string') {
            sendJson(res, 400, { error: 'content string is required' });
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
          sendJson(res, 200, { artifact, ...buildArtifactLinks(artifact.slug) });
          return;
        }

        // GET /api/artifacts/:id/icon.svg
        if (parts[3] === 'icon.svg' && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            sendJson(res, 404, { error: 'Artifact not found' });
            return;
          }
          const svg = resolveArtifactIconSvg(artifact);
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          res.end(svg);
          return;
        }

        // DELETE /api/artifacts/:id
        if (parts.length === 3 && req.method === 'DELETE') {
          const deleted = store.deleteArtifact(idOrSlug);
          if (!deleted) {
            sendJson(res, 404, { error: 'Artifact not found' });
            return;
          }
          broadcast({ type: 'artifact:deleted', id: idOrSlug });
          sendJson(res, 200, { deleted: true });
          return;
        }

        // GET /api/artifacts/:id/versions/:version
        if (parts[3] === 'versions' && parts[4] && req.method === 'GET') {
          const versionNum = Number(parts[4]);
          const content = store.getVersionContent(idOrSlug, versionNum);
          if (content === null) {
            sendJson(res, 404, { error: `Version ${versionNum} not found` });
            return;
          }
          sendJson(res, 200, { version: versionNum, content });
          return;
        }

        // GET /api/artifacts/:id/diff?from=1&to=2
        if (parts[3] === 'diff' && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            sendJson(res, 404, { error: 'Artifact not found' });
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
          sendJson(res, 200, {
            fromVersion: fromVer,
            toVersion: toVer,
            fromContent,
            toContent,
            patch,
          });
          return;
        }

        // POST /api/artifacts/:id/rollback
        if (parts[3] === 'rollback' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const targetVersion = Number(body.version);
          if (!targetVersion) {
            sendJson(res, 400, { error: 'version is required' });
            return;
          }
          const artifact = store.rollbackArtifact(
            idOrSlug,
            targetVersion,
            typeof body.agent === 'string' ? body.agent : 'user'
          );
          broadcast({ type: 'artifact:updated', artifact });
          sendJson(res, 200, { artifact });
          return;
        }

        // GET /api/artifacts/:id/export
        if (parts[3] === 'export' && req.method === 'GET') {
          const artifact = store.getArtifact(idOrSlug);
          if (!artifact) {
            sendJson(res, 404, { error: 'Artifact not found' });
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
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            ...(download
              ? {
                  'Content-Disposition': `attachment; filename="${artifact.slug}-v${
                    versionParam || artifact.currentVersion
                  }.html"`,
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
            sendJson(res, 404, { error: 'Artifact not found' });
            return;
          }

          if (req.method === 'GET') {
            const key = url.searchParams.get('key');
            const prefix = url.searchParams.get('prefix');
            if (key !== null) {
              const result = store.getStorageValue(artifact.id, key);
              sendJson(res, 200, { result });
              return;
            }
            if (prefix !== null) {
              const result = store.listStorageKeys(artifact.id, prefix);
              sendJson(res, 200, { result });
              return;
            }
            const entries = store.getAllStorageEntries(artifact.id);
            sendJson(res, 200, { entries });
            return;
          }

          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await parseJsonBody(req);
            const key = String(body.key || '');
            const value = String(body.value ?? '');
            if (!key) {
              sendJson(res, 400, { error: 'key is required' });
              return;
            }
            const result = store.setStorageValue(artifact.id, key, value);
            broadcast({
              type: 'storage:updated',
              artifactId: artifact.id,
              entries: store.getAllStorageEntries(artifact.id),
            });
            sendJson(res, 200, { result });
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
              sendJson(res, 200, { result });
              return;
            }
            store.clearStorage(artifact.id);
            broadcast({
              type: 'storage:updated',
              artifactId: artifact.id,
              entries: [],
            });
            sendJson(res, 200, { cleared: true });
            return;
          }
        }
      }

      // Serve static frontend files if built
      if (publicDir) {
        const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        let filePath = path.join(publicDir, safePath === '/' ? 'index.html' : safePath);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(publicDir, 'index.html');
        }
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    clients.add(ws);
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
