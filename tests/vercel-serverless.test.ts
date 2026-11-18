import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CloudTokenService, sha256Hex } from '../src/cloud/auth/jwt.js';
import {
  handleVercelRequest,
  resetVercelRuntimeForTests,
} from '../src/cloud/vercel-handler.js';
import type { CloudStore } from '../src/cloud/store-interface.js';
import { CredentialVault } from '../src/cli/credentials.js';
import { CloudHttpRepository } from '../src/client/cloud-repository.js';
import { executeMcpTool } from '../src/mcp/mcp-server.js';
import {
  DEFAULT_AGENT_SCOPE_CEILING,
  ELEVATED_CLI_SCOPES,
  type AuthPrincipalContext,
} from '../src/core/types.js';

const TRACKED_ENV_KEYS = [
  'VERCEL',
  'DATABASE_URL',
  'MYARTIFACT_ALLOW_EPHEMERAL_SQLITE',
  'MYARTIFACT_SECRET',
  'MYARTIFACT_COOKIE_SECRET',
  'MYARTIFACT_DATA_DIR',
  'MYARTIFACT_PUBLIC_URL',
  'MYARTIFACT_S3_ENDPOINT',
  'MYARTIFACT_S3_BUCKET',
  'MYARTIFACT_S3_ACCESS_KEY',
  'MYARTIFACT_S3_SECRET_KEY',
  'MYARTIFACT_ENABLE_WS',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of TRACKED_ENV_KEYS) {
    snap[k] = process.env[k];
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of TRACKED_ENV_KEYS) {
    const val = snap[k];
    if (val === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = val;
    }
  }
}

describe('Vercel Hobby Stateless Deployment', () => {
  test('derives identical ES256 JWT & cookie signing keys across cold starts from MYARTIFACT_SECRET', () => {
    const secret = 'vercel-hobby-master-secret-32-bytes-minimum';
    const coldStartA = new CloudTokenService({ secret });
    const coldStartB = new CloudTokenService({ secret });
    const wrongSecret = new CloudTokenService({ secret: 'different-master-secret-value-32b' });

    const jwt = coldStartA.signAccessJwt({
      sub: 'user-cold-1',
      sid: 'sess-cold-1',
      email: 'tan@acme.com',
      hd: 'acme.com',
      sessionKind: 'cli_delegated',
      scopes: [...DEFAULT_AGENT_SCOPE_CEILING],
      ws: 'ws-1',
    });

    const verifiedB = coldStartB.verifyAccessJwt(jwt);
    assert.ok(verifiedB);
    assert.equal(verifiedB.sub, 'user-cold-1');
    assert.equal(verifiedB.email, 'tan@acme.com');
    assert.equal(wrongSecret.verifyAccessJwt(jwt), null);

    const { cookieValue, csrfToken } = coldStartA.signSessionCookie('sess-web-1', 'user-cold-1');
    const cookieVerifiedB = coldStartB.verifySessionCookie(cookieValue);
    assert.ok(cookieVerifiedB);
    assert.equal(cookieVerifiedB.sid, 'sess-web-1');
    assert.equal(cookieVerifiedB.sub, 'user-cold-1');
    assert.equal(cookieVerifiedB.csrf, csrfToken);
    assert.equal(wrongSecret.verifySessionCookie(cookieValue), null);
  });

  test('fails closed with 503 misconfigured_serverless_env when VERCEL=1 lacks DATABASE_URL', async () => {
    const prevEnv = snapshotEnv();
    await resetVercelRuntimeForTests();

    process.env.VERCEL = '1';
    delete process.env.DATABASE_URL;
    delete process.env.MYARTIFACT_ALLOW_EPHEMERAL_SQLITE;

    const server = http.createServer((req, res) => {
      void handleVercelRequest(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/providers`);
      assert.equal(res.status, 503);
      const body = (await res.json()) as { code?: string; error?: string };
      assert.equal(body.code, 'misconfigured_serverless_env');
      assert.ok(body.error?.includes('DATABASE_URL'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await resetVercelRuntimeForTests();
      restoreEnv(prevEnv);
    }
  });

  test('runs api/index.js with vercel.json rewrites, realtimeWs=false, conditional ETag /api/sync, and zero private-project leaks', async () => {
    const prevEnv = snapshotEnv();
    await resetVercelRuntimeForTests();

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-vercel-test-'));
    const dataDir = path.join(tmpRoot, 'serverless-data');
    const cliDirOwner = path.join(tmpRoot, 'cli-owner');

    process.env.VERCEL = '1';
    process.env.MYARTIFACT_ALLOW_EPHEMERAL_SQLITE = 'true';
    process.env.MYARTIFACT_DATA_DIR = dataDir;
    process.env.MYARTIFACT_SECRET = 'vercel-e2e-test-master-secret-32b';
    delete process.env.DATABASE_URL;
    delete process.env.MYARTIFACT_S3_ENDPOINT;
    delete process.env.MYARTIFACT_ENABLE_WS;

    const apiEntryUrl = new URL('../api/index.js', import.meta.url).href;
    const apiMod = (await import(apiEntryUrl)) as {
      default: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
    };
    const vercelEntryHandler = apiMod.default;
    assert.equal(typeof vercelEntryHandler, 'function');

    // Simulate Vercel routing rewrites from vercel.json before dispatching to api/index.js
    const server = http.createServer((req, res) => {
      const incoming = new URL(req.url || '/', 'http://127.0.0.1');
      if (incoming.pathname.startsWith('/api/') || incoming.pathname === '/favicon.svg') {
        incoming.searchParams.set('__ma_path', incoming.pathname);
        req.url = `/api?${incoming.searchParams.toString()}`;
      }
      void vercelEntryHandler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. /favicon.svg rewrite works through api/index.js
      const favRes = await fetch(`${baseUrl}/favicon.svg`);
      assert.equal(favRes.status, 200);
      assert.ok((favRes.headers.get('content-type') || '').includes('image/svg+xml'));
      const favBody = await favRes.text();
      assert.ok(favBody.includes('<svg'));

      // 2. /api/auth/providers announces realtimeWs: false in serverless mode
      const provRes = await fetch(`${baseUrl}/api/auth/providers`);
      assert.equal(provRes.status, 200);
      const prov = (await provRes.json()) as { mode: string; realtimeWs: boolean };
      assert.equal(prov.mode, 'cloud');
      assert.equal(prov.realtimeWs, false);

      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const health = (await healthRes.json()) as { realtimeWs: boolean; serverless: boolean };
      assert.equal(health.realtimeWs, false);
      assert.equal(health.serverless, true);

      // 3. Provision owner & outsider via the live runtime initialized by api/index.js
      const runtimePromise = (
        globalThis as unknown as {
          __myartifactVercelRuntimePromise?: Promise<{
            store: CloudStore;
            tokenService: CloudTokenService;
          }>;
        }
      ).__myartifactVercelRuntimePromise;
      assert.ok(runtimePromise);
      const { store, tokenService } = await runtimePromise;

      const { user: owner, personalWorkspace: ws } = await store.upsertGoogleUser({
        googleSub: 'sub-vc-owner',
        email: 'owner@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Vercel Owner',
      });
      const ownerCtx: AuthPrincipalContext = {
        authenticated: true,
        user: owner,
        sessionKind: 'cli_elevated',
        scopes: [...ELEVATED_CLI_SCOPES],
        viaAgent: 'cli',
      };

      const { user: outsider } = await store.upsertGoogleUser({
        googleSub: 'sub-vc-outsider',
        email: 'outsider@other.org',
        emailVerified: true,
        displayName: 'Outsider',
      });

      const ownerSess = await store.createAuthSession({
        userId: owner.id,
        sessionKind: 'cli_delegated',
        refreshTokenHash: sha256Hex('rt_vc_owner'),
        scopeCeiling: [...DEFAULT_AGENT_SCOPE_CEILING],
        defaultWorkspaceId: ws.id,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      const ownerJwt = tokenService.signAccessJwt({
        sub: owner.id,
        sid: ownerSess.id,
        email: owner.email,
        hd: owner.googleHd,
        sessionKind: 'cli_delegated',
        scopes: [...DEFAULT_AGENT_SCOPE_CEILING],
        ws: ws.id,
      });

      const outsiderSess = await store.createAuthSession({
        userId: outsider.id,
        sessionKind: 'cli_delegated',
        refreshTokenHash: sha256Hex('rt_vc_outsider'),
        scopeCeiling: [...DEFAULT_AGENT_SCOPE_CEILING],
        defaultWorkspaceId: ws.id,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      const outsiderJwt = tokenService.signAccessJwt({
        sub: outsider.id,
        sid: outsiderSess.id,
        email: outsider.email,
        sessionKind: 'cli_delegated',
        scopes: [...DEFAULT_AGENT_SCOPE_CEILING],
        ws: ws.id,
      });

      const vault = new CredentialVault(cliDirOwner);
      vault.writeCredentials({
        cloudUrl: baseUrl,
        accessToken: ownerJwt,
        refreshToken: 'rt_vc_owner',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        sessionId: ownerSess.id,
        sessionKind: 'cli_delegated',
        scopes: [...DEFAULT_AGENT_SCOPE_CEILING],
        defaultWorkspaceId: ws.id,
        user: owner,
      });
      const ownerRepo = new CloudHttpRepository({
        cloudUrl: baseUrl,
        vault,
        workspace: ws.id,
        agent: 'codex',
      });

      // Grant outsider viewer access at workspace level, create a public artifact & a private project
      await store.applyBatchGrants(ownerCtx, ws.id, {
        resources: [{ type: 'workspace', id: ws.id }],
        principals: [{ type: 'email', email: outsider.email }],
        role: 'viewer',
      });

      await ownerRepo.createArtifact({
        slug: 'dash-1',
        title: 'Public Dashboard',
        type: 'react',
        project: 'general',
        content: 'export default function Dash() { return <div>v1</div>; }',
      });

      await store.createArtifact(ownerCtx, ws.id, {
        slug: 'secret-roadmap',
        title: 'Secret Roadmap',
        type: 'markdown',
        project: 'secret-project',
        content: '# Secret v1',
      });
      await store.setProjectVisibility(ownerCtx, ws.id, 'secret-project', false);

      // 4. Initial /api/sync returns 200 + ETag + artifact/storage revisions
      const sync1Res = await fetch(`${baseUrl}/api/sync?artifact=dash-1`, {
        headers: {
          Authorization: `Bearer ${ownerJwt}`,
          'X-MyArtifact-Workspace': ws.id,
        },
      });
      assert.equal(sync1Res.status, 200);
      const etag1 = sync1Res.headers.get('etag');
      assert.ok(etag1 && etag1.startsWith('W/"'));
      const sync1 = (await sync1Res.json()) as {
        revision: string;
        artifactRevision?: string;
        storageRevision?: string;
      };
      assert.ok(sync1.revision);
      assert.ok(sync1.artifactRevision);
      assert.ok(sync1.storageRevision);

      // 5. Repeat /api/sync with matching ETag returns 304 Not Modified
      const sync304Res = await fetch(`${baseUrl}/api/sync?artifact=dash-1`, {
        headers: {
          Authorization: `Bearer ${ownerJwt}`,
          'X-MyArtifact-Workspace': ws.id,
          'If-None-Match': etag1!,
        },
      });
      assert.equal(sync304Res.status, 304);
      assert.equal(await sync304Res.text(), '');

      // Baseline ETag for outsider before mutating secret-project
      const outsiderSync1 = await fetch(`${baseUrl}/api/sync`, {
        headers: {
          Authorization: `Bearer ${outsiderJwt}`,
          'X-MyArtifact-Workspace': ws.id,
        },
      });
      assert.equal(outsiderSync1.status, 200);
      const outsiderEtag1 = outsiderSync1.headers.get('etag')!;

      // 6. Mutating private secret-roadmap does NOT bump outsider's sync revision (stays 304!)
      await store.updateArtifact(ownerCtx, ws.id, 'secret-roadmap', {
        content: '# Secret v2 (confidential)',
        summary: 'Confidential update',
      });
      const outsiderAfterSecretUpdate = await fetch(`${baseUrl}/api/sync`, {
        headers: {
          Authorization: `Bearer ${outsiderJwt}`,
          'X-MyArtifact-Workspace': ws.id,
          'If-None-Match': outsiderEtag1,
        },
      });
      assert.equal(outsiderAfterSecretUpdate.status, 304);

      // 7. Mutating dash-1 via MCP artifact_update bumps revision & artifactRevision (200)
      await executeMcpTool(ownerRepo, 'artifact_update', {
        id: 'dash-1',
        content: 'export default function Dash() { return <div>v2</div>; }',
        summary: 'Updated via MCP',
      });

      const sync2Res = await fetch(`${baseUrl}/api/sync?artifact=dash-1`, {
        headers: {
          Authorization: `Bearer ${ownerJwt}`,
          'X-MyArtifact-Workspace': ws.id,
          'If-None-Match': etag1!,
        },
      });
      assert.equal(sync2Res.status, 200);
      const etag2 = sync2Res.headers.get('etag')!;
      const sync2 = (await sync2Res.json()) as typeof sync1;
      assert.notEqual(sync2.revision, sync1.revision);
      assert.notEqual(sync2.artifactRevision, sync1.artifactRevision);
      assert.equal(sync2.storageRevision, sync1.storageRevision);

      // 8. Mutating window.storage via MCP artifact_storage_set bumps revision & storageRevision
      await executeMcpTool(ownerRepo, 'artifact_storage_set', {
        id: 'dash-1',
        key: 'chart_filter',
        value: 'last_7d',
      });

      const sync3Res = await fetch(`${baseUrl}/api/sync?artifact=dash-1`, {
        headers: {
          Authorization: `Bearer ${ownerJwt}`,
          'X-MyArtifact-Workspace': ws.id,
          'If-None-Match': etag2,
        },
      });
      assert.equal(sync3Res.status, 200);
      const sync3 = (await sync3Res.json()) as typeof sync1;
      assert.notEqual(sync3.revision, sync2.revision);
      assert.notEqual(sync3.storageRevision, sync2.storageRevision);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await resetVercelRuntimeForTests();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      restoreEnv(prevEnv);
    }
  });
});
