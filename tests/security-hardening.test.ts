import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ArtifactStore } from '../src/core/storage.js';
import { resolveArtifactIconSvg } from '../src/core/icons.js';
import { buildSandboxHtml } from '../src/core/sandbox-template.js';
import {
  ELEVATED_CLI_SCOPES,
  ROLE_RANK,
  type AuthPrincipalContext,
  type BatchShareRequest,
} from '../src/core/types.js';
import { startArtifactServer } from '../src/server/server.js';
import { startArtifactWatcher } from '../src/server/watcher.js';
import { sanitizeRelativeRedirectPath } from '../src/cloud/cloud-server.js';
import { GoogleOidcVerifier } from '../src/cloud/auth/google-oidc.js';
import { CloudTokenService, sha256Hex } from '../src/cloud/auth/jwt.js';
import { LocalDiskBlobStore } from '../src/cloud/blob-store.js';
import { PostgresCloudStore } from '../src/cloud/postgres-store.js';
import { CloudPermissionError } from '../src/cloud/rbac.js';
import { SqliteCloudStore } from '../src/cloud/sqlite-cloud-store.js';
import { loginWithLoopbackPkce } from '../src/cli/auth.js';

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
  jwk.kid = 'mock-google-sec-k1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const identity: MockIdentity = {
    sub: 'sec-google-sub-1',
    email: 'owner@acme.com',
    email_verified: true,
    hd: 'acme.com',
    name: 'Security Owner',
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
      const code = `sec_code_${crypto.randomBytes(8).toString('hex')}`;
      issuedCodes.set(code, { nonce, identity: { ...identity } });
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
        JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock-google-sec-k1' })
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

function rawHttpRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitFor<T>(
  check: () => T | null | undefined | false,
  timeoutMs = 3000,
  intervalMs = 40
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = check();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const finalVal = check();
  if (finalVal) return finalVal;
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('Security Hardening Verification Suite', () => {
  test('Cloud Auth: blocks delegated CLI approval, caps cli_elevated refresh <= 24h, blocks open redirects & enforces sandbox CSP', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-sec-cloud-auth-'));
    const serverDir = path.join(tmpRoot, 'server');
    const cliDelegatedDir = path.join(tmpRoot, 'cli-delegated');
    const cliElevatedDir = path.join(tmpRoot, 'cli-elevated');

    const mockOidc = await startMockGoogleOidcServer('mock-sec-client-id');
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

      // 1. OAuth open redirect prevention: ?next=//evil.com must redirect to '/'
      const loginEvilNext = await fetch(
        `${baseUrl}/api/auth/google/login?next=${encodeURIComponent('//evil.com')}`,
        { redirect: 'manual' }
      );
      assert.equal(loginEvilNext.status, 302);
      const mockAuthEvil = await fetch(loginEvilNext.headers.get('location')!, {
        redirect: 'manual',
      });
      const callbackEvil = await fetch(mockAuthEvil.headers.get('location')!, {
        redirect: 'manual',
      });
      assert.equal(callbackEvil.status, 302);
      assert.equal(callbackEvil.headers.get('location'), '/');

      assert.equal(sanitizeRelativeRedirectPath('//evil.com'), '/');
      assert.equal(sanitizeRelativeRedirectPath('/\\evil.com'), '/');
      assert.equal(sanitizeRelativeRedirectPath('https://evil.com/phish'), '/');
      assert.equal(sanitizeRelativeRedirectPath('/ok/path?tab=1'), '/ok/path?tab=1');

      const cookies = extractCookies(callbackEvil);
      assert.ok(cookies.ma_session);
      assert.ok(cookies.ma_csrf);
      const cookieHeader = `ma_session=${encodeURIComponent(cookies.ma_session)}; ma_csrf=${encodeURIComponent(cookies.ma_csrf)}`;
      const me = (await (
        await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieHeader } })
      ).json()) as { csrfToken: string; user: { id: string }; defaultWorkspaceId: string };

      // 2. Obtain cli_delegated session via Loopback PKCE and verify it CANNOT approve CLI/Device sessions (403)
      const delegatedCreds = await loginWithLoopbackPkce({
        cloudUrl: baseUrl,
        dataDir: cliDelegatedDir,
        noBrowser: true,
        elevate: false,
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
            }),
          });
          assert.equal(approveRes.status, 200);
          const { redirectUrl } = (await approveRes.json()) as { redirectUrl: string };
          await fetch(redirectUrl);
        },
      });
      assert.equal(delegatedCreds.sessionKind, 'cli_delegated');

      const cliApproveWithBearer = await fetch(`${baseUrl}/api/auth/cli/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${delegatedCreds.accessToken}`,
        },
        body: JSON.stringify({
          redirectUri: 'http://127.0.0.1:41234/callback',
          codeChallenge: 'dummy_challenge_12345',
          elevate: true,
        }),
      });
      assert.equal(cliApproveWithBearer.status, 403);
      const cliApproveErr = (await cliApproveWithBearer.json()) as { code?: string };
      assert.equal(cliApproveErr.code, 'agent_scope_restricted');

      const deviceApproveWithBearer = await fetch(`${baseUrl}/api/auth/device/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${delegatedCreds.accessToken}`,
        },
        body: JSON.stringify({ userCode: 'ABCD-1234', elevate: true }),
      });
      assert.equal(deviceApproveWithBearer.status, 403);
      const devApproveErr = (await deviceApproveWithBearer.json()) as { code?: string };
      assert.equal(devApproveErr.code, 'agent_scope_restricted');

      // 3. cli_elevated refresh token rotation caps expiry to <= 24h (not 90 days)
      const elevatedCreds = await loginWithLoopbackPkce({
        cloudUrl: baseUrl,
        dataDir: cliElevatedDir,
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
          assert.equal(approveRes.status, 200);
          const { redirectUrl } = (await approveRes.json()) as { redirectUrl: string };
          await fetch(redirectUrl);
        },
      });
      assert.equal(elevatedCreds.sessionKind, 'cli_elevated');

      const refreshRes = await fetch(`${baseUrl}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: elevatedCreds.refreshToken,
        }),
      });
      assert.equal(refreshRes.status, 200);
      const rotatedBody = (await refreshRes.json()) as {
        sessionId: string;
        refreshToken: string;
        sessionKind: string;
      };
      assert.equal(rotatedBody.sessionKind, 'cli_elevated');

      const oneDayMs = 24 * 3600 * 1000;
      const elevSessionAfterHttp = await cloudStore.getAuthSession(rotatedBody.sessionId);
      assert.ok(elevSessionAfterHttp);
      const ttlFromCreated =
        Date.parse(elevSessionAfterHttp.expiresAt) - Date.parse(elevSessionAfterHttp.createdAt);
      assert.ok(
        ttlFromCreated <= oneDayMs + 1000,
        `Expected cli_elevated expiry <= 24h, got ${ttlFromCreated}ms`
      );
      assert.ok(Date.parse(elevSessionAfterHttp.expiresAt) - Date.now() <= oneDayMs + 1000);

      // Even if a store caller attempts to extend a cli_elevated session to 90 days, capSessionExpiresAt enforces <= 24h
      const ninetyDaysLater = new Date(Date.now() + 90 * oneDayMs).toISOString();
      const storeRotated = await cloudStore.rotateRefreshToken({
        presentedTokenHash: sha256Hex(rotatedBody.refreshToken),
        nextRefreshTokenHash: sha256Hex('manual_rt_elev_test'),
        nextExpiresAt: ninetyDaysLater,
      });
      assert.ok(
        Date.parse(storeRotated.session.expiresAt) - Date.parse(storeRotated.session.createdAt) <=
          oneDayMs + 1000
      );

      // 4. Cloud /export and /icon.svg sandbox CSP headers
      const createArtRes = await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          'X-CSRF-Token': me.csrfToken,
        },
        body: JSON.stringify({
          slug: 'csp-check',
          title: 'CSP Check',
          type: 'react',
          content: 'export default function App() { return <div>CSP</div>; }',
        }),
      });
      assert.equal(createArtRes.status, 201);

      const exportRes = await fetch(`${baseUrl}/api/artifacts/csp-check/export`, {
        headers: { Cookie: cookieHeader },
      });
      assert.equal(exportRes.status, 200);
      const exportCsp = exportRes.headers.get('content-security-policy') || '';
      assert.ok(exportCsp.includes('sandbox'));
      assert.ok(!exportCsp.includes('allow-same-origin'));
      assert.equal(exportRes.headers.get('x-content-type-options'), 'nosniff');

      const iconRes = await fetch(`${baseUrl}/api/artifacts/csp-check/icon.svg`, {
        headers: { Cookie: cookieHeader },
      });
      assert.equal(iconRes.status, 200);
      const iconCsp = iconRes.headers.get('content-security-policy') || '';
      assert.ok(iconCsp.includes('sandbox'));
      assert.equal(iconRes.headers.get('x-content-type-options'), 'nosniff');

      const faviconRes = await fetch(`${baseUrl}/favicon.svg`);
      assert.equal(faviconRes.status, 200);
      assert.ok((faviconRes.headers.get('content-security-policy') || '').includes('sandbox'));
    } finally {
      await running.close();
      await cloudStore.close();
      await mockOidc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('Core SVG Sanitization & Sandbox HTML Escaping', () => {
    // 1. resolveArtifactIconSvg strips dangerous SVG vectors
    const dangerousSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" onload="alert(1)">
      <script>alert('xss')</script>
      <foreignObject width="32" height="32"><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(2) /></body></foreignObject>
      <a href="javascript:alert(3)" xlink:href="javascript:alert(4)"><circle cx="16" cy="16" r="8" onclick="alert(5)"/></a>
    </svg>`;

    const sanitizedDirect = resolveArtifactIconSvg({
      slug: 'evil-icon',
      title: 'Evil Icon',
      type: 'react',
      icon: dangerousSvg,
    });
    assert.ok(/^<svg[\s>]/i.test(sanitizedDirect));
    assert.ok(!/<script/i.test(sanitizedDirect));
    assert.ok(!/\bonload\s*=/i.test(sanitizedDirect));
    assert.ok(!/\bonclick\s*=/i.test(sanitizedDirect));
    assert.ok(!/<foreignObject/i.test(sanitizedDirect));
    assert.ok(!/javascript:/i.test(sanitizedDirect));

    const sanitizedExtracted = resolveArtifactIconSvg({
      slug: 'evil-extracted',
      title: 'Evil Extracted',
      type: 'react',
      content: `/* icon:start */ ${dangerousSvg} /* icon:end */\nexport default function A(){return null;}`,
    });
    assert.ok(!/<script/i.test(sanitizedExtracted));
    assert.ok(!/\bonload\s*=/i.test(sanitizedExtracted));
    assert.ok(!/<foreignObject/i.test(sanitizedExtracted));
    assert.ok(!/javascript:/i.test(sanitizedExtracted));

    // 2. buildSandboxHtml escapes </script> inside artifact content and initialStorage
    const reactHtml = buildSandboxHtml({
      artifactId: 'art-xss-1',
      title: 'Safe </script><title>Title',
      type: 'react',
      content: 'const x = "</script><script>alert(1)</script>";',
      initialStorage: {
        payload: '</script><script>alert(2)</script>',
      },
      standalone: true,
    });
    assert.ok(!reactHtml.includes('</script><script>alert(1)</script>'));
    assert.ok(!reactHtml.includes('</script><script>alert(2)</script>'));
    assert.ok(reactHtml.includes('\\u003c/script\\u003e'));

    // 3. buildSandboxHtml escapes HTML in TensorBoard manifest fields (both script breakouts and DOM template rendering)
    const manifestPayload = {
      title: 'Run <script>alert(1)</script>',
      runSlug: 'run-xss-<img src=x onerror=alert(2)>',
      experiment: 'exp-<svg onload=alert(3)>',
      modelName: 'model-<b>bold</b>',
      status: 'running',
      framework: 'pytorch<script>',
      logDir: '/tmp/runs/<img src=x onerror=alert(4)>',
      eventFilePath: '/tmp/events/<script>alert(5)</script>',
      hparams: {
        '<img src=x onerror=alert(6)>': '<script>alert(7)</script>',
      },
      scalars: {
        '<img src=x onerror=alert(8)>': [{ step: 1, value: 0.5, wallTime: 100 }],
      },
      checkpoints: [
        {
          id: 'ckpt-1',
          name: 'ckpt-<img src=x onerror=alert(9)>.safetensors',
          step: 1,
          filePath: '/tmp/<script>alert(10)</script>.safetensors',
          format: 'safetensors<svg>',
          byteSize: 128,
          sha256: 'deadbeef1234',
          isBest: true,
          metrics: { '<script>loss</script>': 0.25 },
        },
      ],
    };

    const tbHtml = buildSandboxHtml({
      artifactId: 'tb-xss-1',
      title: '<img src=x onerror=alert(0)>',
      type: 'tensorboard',
      content: JSON.stringify(manifestPayload),
    });

    assert.ok(tbHtml.includes('<title>&lt;img src=x onerror=alert(0)&gt;</title>'));
    assert.ok(!tbHtml.includes('</script><script>alert('));

    // Execute the inline TensorBoard renderer script in a sandboxed VM to verify DOM output escaping across tabs
    const scriptMatches = Array.from(tbHtml.matchAll(/<script>([\s\S]*?)<\/script>/g));
    const renderScript = scriptMatches.map((m) => m[1]).find((s) => s.includes('function esc('));
    assert.ok(renderScript, 'TensorBoard render script block should exist');

    const rootEl = {
      innerHTML: '',
      querySelectorAll: () => [],
    };
    const mockDocument = {
      getElementById: (id: string) => (id === 'app' ? rootEl : null),
    };

    for (const tab of ['scalars', 'checkpoints', 'hparams']) {
      const tabbedScript = renderScript.replace(
        "let activeTab = 'scalars';",
        `let activeTab = '${tab}';`
      );
      rootEl.innerHTML = '';
      vm.runInNewContext(tabbedScript, { document: mockDocument });
      assert.ok(
        rootEl.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
        `Tab "${tab}" should render escaped title`
      );
      assert.ok(
        !rootEl.innerHTML.includes('<script>alert('),
        `Tab "${tab}" rendered unescaped <script> tag`
      );
      assert.ok(
        !rootEl.innerHTML.includes('<img src=x'),
        `Tab "${tab}" rendered unescaped <img> tag`
      );
      assert.ok(
        !rootEl.innerHTML.includes('<svg onload='),
        `Tab "${tab}" rendered unescaped <svg onload=> tag`
      );
    }
  });

  test('Cloud RBAC & Store Guards: blocks admin->owner escalation, last-owner removal, share-link ACL enumeration (401), and invalid checkpoint finalization', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-sec-rbac-'));
    const cloudStore = new SqliteCloudStore(tmpDir);
    const tokenService = new CloudTokenService({ dataDir: tmpDir });
    const running = await startArtifactServer({
      port: 0,
      mode: 'cloud',
      cloud: { dataDir: tmpDir, cloudStore, tokenService },
    });

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;
      const ownerRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sec-owner-sub',
        email: 'sec-owner@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Owner',
      });
      const adminRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sec-admin-sub',
        email: 'sec-admin@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Admin',
      });
      const targetRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sec-target-sub',
        email: 'sec-target@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Target',
      });

      const ownerCtx: AuthPrincipalContext = {
        authenticated: true,
        user: ownerRes.user,
        scopes: [...ELEVATED_CLI_SCOPES],
        viaAgent: 'web',
      };
      const adminCtx: AuthPrincipalContext = {
        authenticated: true,
        user: adminRes.user,
        scopes: [...ELEVATED_CLI_SCOPES],
        viaAgent: 'web',
      };

      const wsA = await cloudStore.createWorkspace(ownerCtx, {
        slug: 'sec-ws-a',
        name: 'Security Workspace A',
      });
      const wsB = await cloudStore.createWorkspace(ownerCtx, {
        slug: 'sec-ws-b',
        name: 'Security Workspace B',
      });

      // Grant admin role on wsA
      await cloudStore.applyBatchGrants(ownerCtx, wsA.id, {
        resources: [{ type: 'workspace', id: wsA.id }],
        principals: [{ type: 'email', email: adminRes.user.email }],
        role: 'admin',
      });

      // 1. Admin CANNOT grant owner
      await assert.rejects(
        () =>
          cloudStore.applyBatchGrants(adminCtx, wsA.id, {
            resources: [{ type: 'workspace', id: wsA.id }],
            principals: [{ type: 'email', email: targetRes.user.email }],
            role: 'owner' as unknown as BatchShareRequest['role'],
          }),
        (err: unknown) => err instanceof CloudPermissionError && err.statusCode === 403
      );

      // 2. Admin CANNOT revoke owner
      await assert.rejects(
        () =>
          cloudStore.revokeBatchGrants(adminCtx, wsA.id, {
            resources: [{ type: 'workspace', id: wsA.id }],
            principals: [{ type: 'email', email: ownerRes.user.email }],
          }),
        (err: unknown) => err instanceof CloudPermissionError && err.statusCode === 403
      );

      // 3. Even owner CANNOT remove the last workspace owner
      await assert.rejects(
        () =>
          cloudStore.revokeBatchGrants(ownerCtx, wsA.id, {
            resources: [{ type: 'workspace', id: wsA.id }],
            principals: [{ type: 'email', email: ownerRes.user.email }],
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 400 &&
          err.message.includes('last workspace owner')
      );

      // 4. getResourceAcl rejects anonymous share-link callers (401)
      const artA = await cloudStore.createArtifact(ownerCtx, wsA.id, {
        slug: 'shared-art',
        title: 'Shared Artifact',
        type: 'markdown',
        content: '# Shared',
      });
      const { link, token } = await cloudStore.createShareLink(ownerCtx, wsA.id, {
        accessMode: 'anyone',
        role: 'viewer',
        targetSpec: { kind: 'artifact', artifactIds: [artA.id] },
      });

      const anonShareCtx: AuthPrincipalContext = {
        authenticated: false,
        scopes: ['artifacts:read'],
        viaAgent: 'web',
        shareLink: link,
      };
      await assert.rejects(
        () => cloudStore.getResourceAcl(anonShareCtx, wsA.id, 'workspace', wsA.id),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 401 &&
          err.code === 'unauthenticated'
      );

      const aclHttpRes = await fetch(
        `${baseUrl}/api/workspaces/${wsA.id}/iam/acl?resourceType=workspace&resourceKey=${wsA.id}`,
        { headers: { 'X-Share-Token': token } }
      );
      assert.equal(aclHttpRes.status, 401);

      // 5. SqliteCloudStore finalizeCheckpointUpload guards (direct + HTTP)
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();
      const crossWsKey = `workspaces/${wsB.id}/runs/run-1/checkpoints/${uuid1}/weights.safetensors`;
      await cloudStore.blobStore.putObject(crossWsKey, Buffer.from('FAKE_WEIGHTS'));

      await assert.rejects(
        () =>
          cloudStore.finalizeCheckpointUpload(ownerCtx, wsA.id, 'run-1', {
            checkpointId: uuid1,
            objectKey: crossWsKey,
            name: 'weights.safetensors',
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 403 &&
          err.message === 'Invalid checkpoint objectKey'
      );

      const mismatchedKey = `workspaces/${wsA.id}/runs/run-1/checkpoints/${uuid2}/weights.safetensors`;
      await cloudStore.blobStore.putObject(mismatchedKey, Buffer.from('FAKE_WEIGHTS_2'));

      await assert.rejects(
        () =>
          cloudStore.finalizeCheckpointUpload(ownerCtx, wsA.id, 'run-1', {
            checkpointId: uuid1,
            objectKey: mismatchedKey,
            name: 'weights.safetensors',
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 403 &&
          err.message === 'Invalid checkpoint objectKey'
      );

      await assert.rejects(
        () =>
          cloudStore.finalizeCheckpointUpload(ownerCtx, wsA.id, 'run-1', {
            checkpointId: 'not-a-valid-uuid',
            objectKey: `workspaces/${wsA.id}/runs/run-1/checkpoints/not-a-valid-uuid/weights.safetensors`,
            name: 'weights.safetensors',
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 400 &&
          err.message === 'Invalid checkpointId'
      );

      // Verify HTTP endpoint enforces the same 403 / 400 rejections
      const ownerSession = await cloudStore.createAuthSession({
        userId: ownerRes.user.id,
        sessionKind: 'cli_elevated',
        refreshTokenHash: sha256Hex('sec_rbac_rt'),
        scopeCeiling: [...ELEVATED_CLI_SCOPES],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const ownerJwt = tokenService.signAccessJwt({
        sub: ownerRes.user.id,
        sid: ownerSession.id,
        email: ownerRes.user.email,
        hd: ownerRes.user.googleHd,
        sessionKind: 'cli_elevated',
        scopes: [...ELEVATED_CLI_SCOPES],
      });

      const httpCrossWsRes = await fetch(
        `${baseUrl}/api/tensorboard/runs/run-1/checkpoints:finalize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerJwt}`,
            'X-MyArtifact-Workspace': wsA.id,
          },
          body: JSON.stringify({
            checkpointId: uuid1,
            objectKey: crossWsKey,
            name: 'weights.safetensors',
          }),
        }
      );
      assert.equal(httpCrossWsRes.status, 403);

      const httpMismatchRes = await fetch(
        `${baseUrl}/api/tensorboard/runs/run-1/checkpoints:finalize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerJwt}`,
            'X-MyArtifact-Workspace': wsA.id,
          },
          body: JSON.stringify({
            checkpointId: uuid1,
            objectKey: mismatchedKey,
            name: 'weights.safetensors',
          }),
        }
      );
      assert.equal(httpMismatchRes.status, 403);

      // 6. PostgresCloudStore finalizeCheckpointUpload guard check via mock pool
      const mockPgPool = {
        async query(sql: string) {
          if (sql.includes('FROM role_bindings')) {
            return {
              rows: [
                {
                  principal_type: 'user',
                  principal_key: ownerRes.user.id,
                  role_rank: ROLE_RANK.owner,
                  expires_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
        async connect() {
          throw new Error('not expected');
        },
        async end() {},
      };
      const PgCtor = PostgresCloudStore as unknown as new (
        pool: typeof mockPgPool,
        blobStore: LocalDiskBlobStore,
        enableListenNotify?: boolean
      ) => PostgresCloudStore;
      const pgStore = new PgCtor(
        mockPgPool,
        new LocalDiskBlobStore(path.join(tmpDir, 'pg-blobs')),
        false
      );

      await assert.rejects(
        () =>
          pgStore.finalizeCheckpointUpload(ownerCtx, wsA.id, 'run-1', {
            checkpointId: uuid1,
            objectKey: crossWsKey,
            name: 'weights.safetensors',
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 403 &&
          err.message === 'Invalid checkpoint objectKey'
      );
      await assert.rejects(
        () =>
          pgStore.finalizeCheckpointUpload(ownerCtx, wsA.id, 'run-1', {
            checkpointId: uuid1,
            objectKey: mismatchedKey,
            name: 'weights.safetensors',
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 403 &&
          err.message === 'Invalid checkpoint objectKey'
      );
      await assert.rejects(
        () =>
          pgStore.finalizeCheckpointUpload(ownerCtx, wsA.id, 'run-1', {
            checkpointId: 'bad-uuid',
            objectKey: `workspaces/${wsA.id}/runs/run-1/checkpoints/bad-uuid/weights.safetensors`,
            name: 'weights.safetensors',
          }),
        (err: unknown) =>
          err instanceof CloudPermissionError &&
          err.statusCode === 400 &&
          err.message === 'Invalid checkpointId'
      );
    } finally {
      await running.close();
      await cloudStore.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Local Server, Dropzone Watcher & LocalDiskBlobStore Hardening', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-sec-local-'));
    const dataDir = path.join(tmpRoot, 'data');
    const outsideDir = path.join(tmpRoot, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });

    const outsideEventsFile = path.join(outsideDir, 'events.out.tfevents.1.host');
    const outsideCkptFile = path.join(outsideDir, 'outside.safetensors');
    const outsideDropFile = path.join(outsideDir, 'outside-secret.md');
    fs.writeFileSync(outsideEventsFile, 'not-real-tfevents');
    fs.writeFileSync(outsideCkptFile, 'OUTSIDE_WEIGHTS');
    fs.writeFileSync(outsideDropFile, '# Outside Secret\nShould never be ingested via symlink');

    const store = new ArtifactStore(dataDir);
    const running = await startArtifactServer({
      port: 0,
      store,
      enableWatcher: false,
    });
    const watcher = startArtifactWatcher(store);

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;

      // 1. Block cross-origin Origin header (403)
      const crossOriginRes = await fetch(`${baseUrl}/api/artifacts`, {
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(crossOriginRes.status, 403);

      // 2. Block non-loopback Host header DNS rebinding (403)
      const rebindRes = await rawHttpRequest({
        port: running.port,
        method: 'GET',
        path: '/api/health',
        headers: { Host: 'evil.example' },
      });
      assert.equal(rebindRes.status, 403);

      // 3. Block HTTP /api/tensorboard/import and checkpoint sourceFilePath outside store.dataDir (403)
      const importOutsideRes = await fetch(`${baseUrl}/api/tensorboard/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: outsideEventsFile, slug: 'evil-import' }),
      });
      assert.equal(importOutsideRes.status, 403);

      const ckptOutsideRes = await fetch(`${baseUrl}/api/tensorboard/runs/evil-run/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'evil.safetensors',
          sourceFilePath: outsideCkptFile,
        }),
      });
      assert.equal(ckptOutsideRes.status, 403);

      // 4. Local /api/artifacts/:id/export and /icon.svg sandbox CSP headers
      const createRes = await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'local-csp-art',
          title: 'Local CSP',
          type: 'react',
          content: 'export default function Local() { return <div>Local</div>; }',
        }),
      });
      assert.equal(createRes.status, 201);

      const localExportRes = await fetch(`${baseUrl}/api/artifacts/local-csp-art/export`);
      assert.equal(localExportRes.status, 200);
      const localExportCsp = localExportRes.headers.get('content-security-policy') || '';
      assert.ok(localExportCsp.includes('sandbox'));
      assert.ok(!localExportCsp.includes('allow-same-origin'));
      assert.equal(localExportRes.headers.get('x-content-type-options'), 'nosniff');

      const localIconRes = await fetch(`${baseUrl}/api/artifacts/local-csp-art/icon.svg`);
      assert.equal(localIconRes.status, 200);
      const localIconCsp = localIconRes.headers.get('content-security-policy') || '';
      assert.ok(localIconCsp.includes('sandbox'));
      assert.equal(localIconRes.headers.get('x-content-type-options'), 'nosniff');

      const localFaviconRes = await fetch(`${baseUrl}/favicon.svg`);
      assert.equal(localFaviconRes.status, 200);
      assert.ok((localFaviconRes.headers.get('content-security-policy') || '').includes('sandbox'));

      // 5. watcher.ts ignores symlinked files dropped into dropzoneDir
      await new Promise((r) => setTimeout(r, 350));
      fs.symlinkSync(outsideDropFile, path.join(store.dropzoneDir, 'sym-leak.md'));
      fs.writeFileSync(
        path.join(store.dropzoneDir, 'control-file.md'),
        '# Control File\nValid regular dropzone file',
        'utf8'
      );

      const control = await waitFor(() => store.getArtifact('control-file'));
      assert.equal(control.slug, 'control-file');
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(store.getArtifact('sym-leak'), null);

      // 6. LocalDiskBlobStore rejects '..' object keys
      const blobStore = new LocalDiskBlobStore(path.join(tmpRoot, 'blobs'));
      await assert.rejects(() => blobStore.putObject('../escape.txt', 'data'), /Invalid object key/);
      await assert.rejects(() => blobStore.putObject('a/../escape.txt', 'data'), /Invalid object key/);
      await assert.rejects(
        () => blobStore.putObject('a\\..\\escape.txt', 'data'),
        /Invalid object key/
      );
      await assert.rejects(() => blobStore.getObjectBuffer('../escape.txt'), /Invalid object key/);
      await assert.rejects(() => blobStore.deleteObject('../escape.txt'), /Invalid object key/);
      await assert.rejects(
        () => blobStore.createPresignedUpload('workspaces/../escape.txt'),
        /Invalid object key/
      );
      await assert.rejects(
        () => blobStore.createPresignedDownload('workspaces/../escape.txt'),
        /Invalid object key/
      );
    } finally {
      await watcher.close();
      await running.close();
      store.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
