import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CloudTokenService } from './auth/jwt.js';
import { createBlobStoreFromEnv, hasS3EnvConfig } from './blob-store.js';
import { CloudHttpRuntime } from './cloud-server.js';
import { PostgresCloudStore } from './postgres-store.js';
import { SqliteCloudStore } from './sqlite-cloud-store.js';

export class VercelConfigError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'misconfigured_serverless_env';
}

interface GlobalVercelCache {
  __myartifactVercelRuntimePromise?: Promise<CloudHttpRuntime>;
}

/**
 * Restore original API path when vercel.json rewrites `/api/(.*)` -> `/api?__ma_path=/api/$1`.
 */
export function normalizeVercelRequestUrl(req: http.IncomingMessage): void {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, 'http://localhost');
  const rewrittenPath = parsed.searchParams.get('__ma_path');
  if (rewrittenPath !== null) {
    parsed.searchParams.delete('__ma_path');
    const normalizedPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
    const qs = parsed.searchParams.toString();
    req.url = `${normalizedPath}${qs ? `?${qs}` : ''}`;
  }
}

export async function createVercelRuntime(): Promise<CloudHttpRuntime> {
  const g = globalThis as unknown as GlobalVercelCache;
  if (!g.__myartifactVercelRuntimePromise) {
    g.__myartifactVercelRuntimePromise = (async () => {
      const isStrictVercel =
        Boolean(process.env.VERCEL) && process.env.MYARTIFACT_ALLOW_EPHEMERAL_SQLITE !== 'true';
      const dbUrl = process.env.DATABASE_URL || '';
      const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

      if (isStrictVercel && !isPostgres) {
        throw new VercelConfigError(
          'MyArtifact serverless mode on Vercel requires DATABASE_URL pointing to PostgreSQL (e.g., Neon Free Tier). Set DATABASE_URL in Vercel Project Settings -> Environment Variables.'
        );
      }

      const hasSigningSecret = Boolean(
        process.env.MYARTIFACT_SECRET ||
          process.env.MYARTIFACT_COOKIE_SECRET ||
          (process.env.MYARTIFACT_JWT_PRIVATE_KEY_PEM &&
            process.env.MYARTIFACT_JWT_PUBLIC_KEY_PEM)
      );
      if (isStrictVercel && !hasSigningSecret) {
        throw new VercelConfigError(
          'MyArtifact serverless mode on Vercel requires MYARTIFACT_SECRET (e.g., `openssl rand -hex 32`) so JWTs and session cookies stay valid across cold starts.'
        );
      }

      const dataDir =
        process.env.MYARTIFACT_DATA_DIR || path.join(os.tmpdir(), 'myartifact-serverless');
      const store = isPostgres
        ? await PostgresCloudStore.connect(
            dbUrl,
            hasS3EnvConfig() ? createBlobStoreFromEnv(dataDir) : undefined,
            { enableListenNotify: false }
          )
        : new SqliteCloudStore(dataDir, createBlobStoreFromEnv(dataDir));

      const tokenService = new CloudTokenService({
        dataDir: isPostgres ? undefined : dataDir,
      });

      const candidatePublicDir = path.resolve(process.cwd(), 'dist/public');
      const publicDir = fs.existsSync(candidatePublicDir) ? candidatePublicDir : undefined;

      return new CloudHttpRuntime({
        store,
        tokenService,
        publicBaseUrl: process.env.MYARTIFACT_PUBLIC_URL,
        publicDir,
        enableRealtimeWs: false,
      });
    })().catch((err) => {
      g.__myartifactVercelRuntimePromise = undefined;
      throw err;
    });
  }
  return g.__myartifactVercelRuntimePromise;
}

export async function handleVercelRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  normalizeVercelRequestUrl(req);
  try {
    const runtime = await createVercelRuntime();
    await runtime.handleRequest(req, res);
  } catch (err) {
    if (err instanceof VercelConfigError) {
      if (!res.headersSent) {
        res.writeHead(err.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: err.message, code: err.code }));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: message }));
  }
}

export async function resetVercelRuntimeForTests(): Promise<void> {
  const g = globalThis as unknown as GlobalVercelCache;
  const pending = g.__myartifactVercelRuntimePromise;
  g.__myartifactVercelRuntimePromise = undefined;
  if (pending) {
    try {
      const runtime = await pending;
      runtime.close();
      await runtime.store.close();
    } catch {
      // Ignore cleanup errors for failed initialization
    }
  }
}
