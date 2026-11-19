import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CloudTokenService } from '../src/cloud/auth/jwt.js';
import { CloudHttpRuntime } from '../src/cloud/cloud-server.js';
import { SqliteCloudStore } from '../src/cloud/sqlite-cloud-store.js';

describe('Pre-Release Verification Regressions', () => {
  test('built CLI --version matches package.json version (1.0.0)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { version: string };
    assert.equal(pkg.version, '1.0.0');

    const cliDist = path.resolve(process.cwd(), 'dist/cli/cli.js');
    assert.ok(fs.existsSync(cliDist), 'dist/cli/cli.js must exist (run npm run build first)');
    const out = execFileSync(process.execPath, [cliDist, '--version'], { encoding: 'utf8' }).trim();
    assert.equal(out, pkg.version);
  });

  test('docker-compose.cloud.yml configures Postgres DATABASE_URL and MYARTIFACT_SECRET for myartifact-cloud', () => {
    const composeText = fs.readFileSync(
      path.resolve(process.cwd(), 'docker-compose.cloud.yml'),
      'utf8'
    );
    const serviceIdx = composeText.indexOf('myartifact-cloud:');
    assert.ok(serviceIdx >= 0, 'myartifact-cloud service must exist');
    const serviceBlock = composeText.slice(serviceIdx);
    assert.match(serviceBlock, /DATABASE_URL:\s*postgresql:\/\/myartifact:.*@postgres:5432\/myartifact/);
    assert.match(serviceBlock, /MYARTIFACT_SECRET:\s*\$\{MYARTIFACT_SECRET:\?Set MYARTIFACT_SECRET\}/);
  });

  test('vercel.json sets /favicon.svg sandbox CSP, static X-Frame-Options, preview X-Robots-Tag, and excludes /api from SPA rewrite', () => {
    const cfg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
    ) as {
      headers: Array<{
        source: string;
        has?: Array<{ type: string; value: string }>;
        headers: Array<{ key: string; value: string }>;
      }>;
      rewrites: Array<{ source: string; destination: string }>;
    };

    const faviconRule = cfg.headers.find((h) => h.source === '/favicon.svg');
    assert.ok(faviconRule, '/favicon.svg header rule must exist');
    assert.equal(
      faviconRule.headers.find((h) => h.key === 'Content-Security-Policy')?.value,
      "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );

    const frameRule = cfg.headers.find((h) => h.source === '/((?!api/|api$).*)');
    assert.ok(frameRule, 'Static X-Frame-Options header rule must exist');
    assert.equal(
      frameRule.headers.find((h) => h.key === 'X-Frame-Options')?.value,
      'SAMEORIGIN'
    );

    const robotsRule = cfg.headers.find(
      (h) =>
        h.source === '/(.*)' &&
        h.has?.some((c) => c.type === 'host' && c.value === '(?:dev\\..*|.*\\.vercel\\.app)')
    );
    assert.ok(robotsRule, 'Preview-host X-Robots-Tag rule must exist');
    assert.equal(
      robotsRule.headers.find((h) => h.key === 'X-Robots-Tag')?.value,
      'noindex, nofollow'
    );

    const spaRule = cfg.rewrites.find((r) => r.destination === '/index.html');
    assert.ok(spaRule, 'SPA fallback rewrite must exist');
    const spaRegex = new RegExp(`^${spaRule.source}$`);
    assert.ok(!spaRegex.test('/api'), 'SPA rewrite must not match exact /api');
    assert.ok(!spaRegex.test('/api/health'), 'SPA rewrite must not match /api/health');
  });

  test('CloudHttpRuntime returns 404 JSON on unknown API routes and 401 on protected routes when unauthenticated', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-prerel-test-'));
    const store = new SqliteCloudStore(tmpDir);
    const tokenService = new CloudTokenService({ secret: 'pre-release-test-secret-32-bytes-ok' });
    const runtime = new CloudHttpRuntime({ store, tokenService, enableRealtimeWs: false });

    const server = http.createServer((req, res) => {
      void runtime.handleRequest(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      for (const unknownPath of ['/api/nonexistent', '/api/w/demo/nonexistent']) {
        const res = await fetch(`${base}${unknownPath}`);
        assert.equal(res.status, 404, `Expected 404 for ${unknownPath}`);
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'API route not found');
      }

      for (const protectedPath of [
        '/api/artifacts',
        '/api/sync',
        '/api/wiki',
        '/api/workspaces',
      ]) {
        const res = await fetch(`${base}${protectedPath}`);
        assert.equal(res.status, 401, `Expected 401 for ${protectedPath}`);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      runtime.close();
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
