import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startArtifactServer } from '../src/server/server.js';
import { GoogleOidcVerifier } from '../src/cloud/auth/google-oidc.js';
import { CloudTokenService, sha256Hex } from '../src/cloud/auth/jwt.js';
import { SqliteCloudStore } from '../src/cloud/sqlite-cloud-store.js';
import { loginWithDeviceFlow, loginWithLoopbackPkce } from '../src/cli/auth.js';
import { CredentialVault } from '../src/cli/credentials.js';
import { CloudHttpRepository } from '../src/client/cloud-repository.js';
import { DEFAULT_AGENT_SCOPE_CEILING } from '../src/core/types.js';

interface MockIdentity {
  sub: string;
  email: string;
  email_verified: boolean;
  hd?: string;
  name: string;
}

async function startMockGoogleOidcServer(clientId: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  jwk.kid = 'mock-google-k1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  let currentIdentity: MockIdentity = {
    sub: 'google-sub-tan',
    email: 'tan@acme.com',
    email_verified: true,
    hd: 'acme.com',
    name: 'Tan Engineer',
  };

  const issuedCodes = new Map<string, { nonce: string; identity: MockIdentity }>();
  let issuer = '';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', issuer || 'http://127.0.0.1');

    if (url.pathname === '/jwks' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (url.pathname === '/authorize' && req.method === 'GET') {
      const state = url.searchParams.get('state') || '';
      const nonce = url.searchParams.get('nonce') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const code = `mock_code_${crypto.randomBytes(8).toString('hex')}`;
      issuedCodes.set(code, { nonce, identity: { ...currentIdentity } });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const code = form.get('code') || '';
      const rec = issuedCodes.get(code);
      if (!rec) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      issuedCodes.delete(code);

      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock-google-k1' })
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: issuer,
          aud: clientId,
          sub: rec.identity.sub,
          email: rec.identity.email,
          email_verified: rec.identity.email_verified,
          ...(rec.identity.hd ? { hd: rec.identity.hd } : {}),
          name: rec.identity.name,
          nonce: rec.nonce,
          iat: now,
          exp: now + 3600,
        })
      ).toString('base64url');
      const sig = crypto
        .sign('RSA-SHA256', Buffer.from(`${header}.${payload}`, 'utf8'), privateKey)
        .toString('base64url');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id_token: `${header}.${payload}.${sig}`, token_type: 'Bearer' }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  issuer = `http://127.0.0.1:${addr.port}`;

  return {
    issuer,
    setIdentity(id: MockIdentity) {
      currentIdentity = id;
    },
    verifier: new GoogleOidcVerifier({
      clientId,
      clientSecret: 'mock-secret',
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksUri: `${issuer}/jwks`,
      acceptedIssuers: [issuer],
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function extractCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const list = res.headers.getSetCookie?.() || [];
  for (const header of list) {
    const first = header.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) {
      out[first.slice(0, eq).trim()] = decodeURIComponent(first.slice(eq + 1).trim());
    }
  }
  return out;
}

describe('Cloud Auth: Google OIDC, CSRF, CLI Login, Refresh Concurrency & Safe Agent Ceiling', () => {
  test('Google OIDC login, email_verified guard, CSRF protection, Loopback PKCE, Device Flow, 8x refresh race & agent ceiling', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-auth-test-'));
    const serverDir = path.join(tmpRoot, 'server');
    const cliDir1 = path.join(tmpRoot, 'cli1');
    const cliDir2 = path.join(tmpRoot, 'cli2');
    const cliDirElevated = path.join(tmpRoot, 'cli-elevated');

    const mockOidc = await startMockGoogleOidcServer('mock-google-client-id');
    const cloudStore = new SqliteCloudStore(serverDir);
    const tokenService = new CloudTokenService({ dataDir: serverDir });
    const running = await startArtifactServer({
      port: 0,
      mode: 'cloud',
      cloud: {
        dataDir: serverDir,
        cloudStore,
        tokenService,
        oidcVerifier: mockOidc.verifier,
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;

      // 1. Reject unverified Google email
      mockOidc.setIdentity({
        sub: 'unverified-sub',
        email: 'unverified@acme.com',
        email_verified: false,
        name: 'Unverified User',
      });
      const loginStartFail = await fetch(`${baseUrl}/api/auth/google/login`, {
        redirect: 'manual',
      });
      assert.equal(loginStartFail.status, 302);
      const mockAuthRespFail = await fetch(loginStartFail.headers.get('location')!, {
        redirect: 'manual',
      });
      const callbackRespFail = await fetch(mockAuthRespFail.headers.get('location')!, {
        redirect: 'manual',
      });
      assert.ok(callbackRespFail.status >= 400);

      // 2. Verified Google OIDC login succeeds & sets HttpOnly session + CSRF cookie
      mockOidc.setIdentity({
        sub: 'google-sub-tan',
        email: 'tan@acme.com',
        email_verified: true,
        hd: 'acme.com',
        name: 'Tan Engineer',
      });
      const loginStart = await fetch(`${baseUrl}/api/auth/google/login`, {
        redirect: 'manual',
      });
      const mockAuthResp = await fetch(loginStart.headers.get('location')!, {
        redirect: 'manual',
      });
      const callbackResp = await fetch(mockAuthResp.headers.get('location')!, {
        redirect: 'manual',
      });
      assert.equal(callbackResp.status, 302);
      const cookies = extractCookies(callbackResp);
      assert.ok(cookies.ma_session);
      assert.ok(cookies.ma_csrf);

      const cookieHeader = `ma_session=${encodeURIComponent(cookies.ma_session)}; ma_csrf=${encodeURIComponent(cookies.ma_csrf)}`;
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookieHeader },
      });
      const me = await meRes.json();
      assert.equal(me.authenticated, true);
      assert.equal(me.user.email, 'tan@acme.com');
      assert.equal(me.user.googleHd, 'acme.com');
      assert.ok(me.workspaces.length >= 1);

      // 3. CSRF guard rejects cookie mutation without X-CSRF-Token
      const csrfFail = await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ title: 'No CSRF', content: 'hi' }),
      });
      assert.equal(csrfFail.status, 403);

      const csrfOk = await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          'X-CSRF-Token': me.csrfToken,
        },
        body: JSON.stringify({
          slug: 'web-seed',
          title: 'Web Seed Artifact',
          type: 'react',
          content: 'export default function App() { return <div>Web</div>; }',
        }),
      });
      assert.equal(csrfOk.status, 201);

      // 4. CLI Loopback PKCE Login (login once for Claude Code / Codex / Antigravity)
      const creds1 = await loginWithLoopbackPkce({
        cloudUrl: baseUrl,
        dataDir: cliDir1,
        noBrowser: true,
        deviceLabel: 'MacBook-Pro',
        onAuthUrl: async (rawUrl) => {
          const authUrl = new URL(rawUrl);
          const approveRes = await fetch(`${baseUrl}/api/auth/cli/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: cookieHeader,
              'X-CSRF-Token': me.csrfToken,
            },
            body: JSON.stringify({
              redirectUri: authUrl.searchParams.get('redirect_uri'),
              codeChallenge: authUrl.searchParams.get('code_challenge'),
              state: authUrl.searchParams.get('state'),
              elevate: false,
              deviceLabel: 'MacBook-Pro',
            }),
          });
          assert.equal(approveRes.status, 200);
          const { redirectUrl } = await approveRes.json();
          const cbRes = await fetch(redirectUrl);
          assert.equal(cbRes.status, 200);
        },
      });
      assert.equal(creds1.sessionKind, 'cli_delegated');
      assert.deepEqual(creds1.scopes, [...DEFAULT_AGENT_SCOPE_CEILING]);
      const credStat = fs.statSync(path.join(cliDir1, 'credentials.json'));
      assert.equal(credStat.mode & 0o777, 0o600);

      // 5. RFC 8628 Device Flow Login (SSH / headless container fallback)
      const creds2 = await loginWithDeviceFlow({
        cloudUrl: baseUrl,
        dataDir: cliDir2,
        noBrowser: true,
        onAuthUrl: async (_url, userCode) => {
          const approveRes = await fetch(`${baseUrl}/api/auth/device/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: cookieHeader,
              'X-CSRF-Token': me.csrfToken,
            },
            body: JSON.stringify({ userCode }),
          });
          assert.equal(approveRes.status, 200);
        },
      });
      assert.equal(creds2.user.email, 'tan@acme.com');
      assert.equal(creds2.sessionKind, 'cli_delegated');

      // 6. 8-Way Parallel Refresh Race Test (simulating concurrent Claude Code, Codex, Antigravity)
      const vault1 = new CredentialVault(cliDir1);
      const stale = vault1.readCredentials()!;
      vault1.writeCredentials({
        ...stale,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const parallelRepos = Array.from({ length: 8 }, (_, idx) => {
        return new CloudHttpRepository({
          cloudUrl: baseUrl,
          vault: new CredentialVault(cliDir1),
          agent: idx % 2 === 0 ? 'claude-code' : 'antigravity',
        });
      });
      const lists = await Promise.all(parallelRepos.map((r) => r.listArtifacts()));
      for (const list of lists) {
        assert.ok(list.some((a) => a.slug === 'web-seed'));
      }
      const afterRace = vault1.readCredentials()!;
      assert.notEqual(afterRace.refreshToken, stale.refreshToken);

      // 7. Safe Agent Ceiling: delegated_agent creates/updates/logs, blocked on delete & batch share
      const agentRepo = new CloudHttpRepository({
        cloudUrl: baseUrl,
        vault: vault1,
        agent: 'claude-code',
      });
      const createdByAgent = await agentRepo.createArtifact({
        slug: 'agent-dashboard',
        title: 'Agent Dashboard',
        type: 'react',
        content: 'export default function App() { return <div>v1</div>; }',
      });
      assert.equal(createdByAgent.authorEmail, 'tan@acme.com');
      assert.equal(createdByAgent.agent, 'claude-code');

      await agentRepo.setStorageValue('agent-dashboard', 'k1', 'v1');
      const kvVal = await agentRepo.getStorageValue('agent-dashboard', 'k1');
      assert.equal(kvVal?.value, 'v1');

      await assert.rejects(
        () => agentRepo.deleteArtifact('agent-dashboard'),
        (err: Error & { statusCode?: number; code?: string }) =>
          err.statusCode === 403 && err.code === 'agent_scope_restricted'
      );

      await assert.rejects(
        () =>
          agentRepo.shareBatch({
            resources: [{ type: 'artifact', id: 'agent-dashboard' }],
            principals: [{ type: 'email', email: 'peer@acme.com' }],
            role: 'viewer',
          }),
        (err: Error & { statusCode?: number; code?: string }) =>
          err.statusCode === 403 && err.code === 'agent_scope_restricted'
      );

      // 8. Elevated CLI session (--elevate) can perform batch share & delete
      await loginWithLoopbackPkce({
        cloudUrl: baseUrl,
        dataDir: cliDirElevated,
        noBrowser: true,
        elevate: true,
        onAuthUrl: async (rawUrl) => {
          const authUrl = new URL(rawUrl);
          const approveRes = await fetch(`${baseUrl}/api/auth/cli/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: cookieHeader,
              'X-CSRF-Token': me.csrfToken,
            },
            body: JSON.stringify({
              redirectUri: authUrl.searchParams.get('redirect_uri'),
              codeChallenge: authUrl.searchParams.get('code_challenge'),
              state: authUrl.searchParams.get('state'),
              elevate: true,
            }),
          });
          const { redirectUrl } = await approveRes.json();
          await fetch(redirectUrl);
        },
      });
      const elevatedRepo = new CloudHttpRepository({
        cloudUrl: baseUrl,
        vault: new CredentialVault(cliDirElevated),
        agent: 'cli',
      });
      const shareRes = await elevatedRepo.shareBatch({
        resources: [{ type: 'artifact', id: 'agent-dashboard' }],
        principals: [{ type: 'email', email: 'peer@acme.com' }],
        role: 'viewer',
      });
      assert.equal(shareRes.applied, 1);
      assert.equal(await elevatedRepo.deleteArtifact('agent-dashboard'), true);

      // 9. Refresh token replay outside 30s grace window revokes the session
      const replaySession = await cloudStore.createAuthSession({
        userId: creds1.user.id,
        sessionKind: 'cli_delegated',
        refreshTokenHash: sha256Hex('rt_initial'),
        scopeCeiling: [...DEFAULT_AGENT_SCOPE_CEILING],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await cloudStore.rotateRefreshToken({
        presentedTokenHash: sha256Hex('rt_initial'),
        nextRefreshTokenHash: sha256Hex('rt_second'),
        nextExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        graceWindowMs: 5,
      });
      await new Promise((r) => setTimeout(r, 20));
      await assert.rejects(() =>
        cloudStore.rotateRefreshToken({
          presentedTokenHash: sha256Hex('rt_initial'),
          nextRefreshTokenHash: sha256Hex('rt_third'),
          nextExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
      );
      const revokedSession = await cloudStore.getAuthSession(replaySession.id);
      assert.ok(revokedSession?.revokedAt);
    } finally {
      await running.close();
      await cloudStore.close();
      await mockOidc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
