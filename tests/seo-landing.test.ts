import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startArtifactServer } from '../src/server/server.js';
import { CloudTokenService } from '../src/cloud/auth/jwt.js';
import { SqliteCloudStore } from '../src/cloud/sqlite-cloud-store.js';

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.subarray(0, 8).equals(pngSig), `${filePath} must have valid PNG header`);
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('Comprehensive SEO Landing Page & Crawler Assets', () => {
  test('dist/public/index.html contains complete SEO meta tags, non-blocking fonts, Wave-1 pre-render H1, code-split entry, and valid JSON-LD @graph', () => {
    const publicDir = path.resolve(process.cwd(), 'dist/public');
    const htmlPath = path.join(publicDir, 'index.html');
    assert.ok(fs.existsSync(htmlPath), 'dist/public/index.html must exist (run npm run build first)');

    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(!html.includes('__SITE_ORIGIN__'), 'Vite plugin must replace __SITE_ORIGIN__ placeholder');
    assert.ok(!html.includes('__GSC_VERIFICATION_META__'), 'Vite plugin must replace GSC verification placeholder');
    assert.match(html, /<title>MyArtifact — .*<\/title>/);
    assert.match(html, /<meta\s+name="description"\s+content="[^"]{80,}"/s);
    assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/myartifact\.app\/"/);
    assert.match(html, /fonts\.googleapis\.com[\s\S]*media="print"/);
    assert.match(html, /<meta\s+property="og:type"\s+content="website"/);
    assert.match(html, /<meta\s+property="og:image"\s+content="https?:\/\/[^"]+\/og-image\.png"/);
    assert.match(html, /<meta\s+property="og:image:width"\s+content="1200"/);
    assert.match(html, /<meta\s+property="og:image:height"\s+content="630"/);
    assert.match(html, /<meta\s+name="twitter:card"\s+content="summary_large_image"/);
    assert.match(html, /<meta\s+name="twitter:image"\s+content="https?:\/\/[^"]+\/og-image\.png"/);
    assert.match(html, /<div id="root">[\s\S]*<h1[^>]*>[\s\S]*<\/h1>[\s\S]*<\/div>/);

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLdMatch, 'Structured data JSON-LD script must exist');
    const jsonLd = JSON.parse(jsonLdMatch[1]) as {
      '@context': string;
      '@graph': Array<{ '@type': string; [k: string]: unknown }>;
    };
    assert.equal(jsonLd['@context'], 'https://schema.org');
    const types = new Set(jsonLd['@graph'].map((n) => n['@type']));
    assert.ok(types.has('Organization'));
    assert.ok(types.has('WebSite'));
    assert.ok(types.has('BreadcrumbList'));
    assert.ok(types.has('SoftwareApplication'));
    assert.ok(types.has('FAQPage'));

    const orgNode = jsonLd['@graph'].find((n) => n['@type'] === 'Organization');
    const orgLogo = orgNode?.logo as { url?: string } | undefined;
    assert.ok(orgLogo?.url?.endsWith('/apple-touch-icon.png'));

    const faqNode = jsonLd['@graph'].find((n) => n['@type'] === 'FAQPage');
    assert.ok(Array.isArray(faqNode?.mainEntity) && faqNode.mainEntity.length >= 5);

    // Verify pre-rendered Humans & Agents Cloud onboarding sections exist inside Wave-1 HTML
    assert.match(html, /id="quickstart"/);
    assert.match(html, /For Humans/);
    assert.match(html, /For Agents/);
    assert.match(html, /artifact_wiki_index\(\)/);
    assert.match(html, /npm i -g github:TannedCung\/MyArtifact/);
    assert.match(html, /myartifact login --cloud https:\/\/myartifact\.app/);
    const quickstartMatch = html.match(/<section id="quickstart"[\s\S]*?<\/section>/);
    assert.ok(quickstartMatch, 'Built index.html must contain #quickstart section');
    assert.doesNotMatch(
      quickstartMatch[0],
      /myartifact serve/,
      '#quickstart Cloud onboarding section must not instruct local myartifact serve'
    );

    // Verify local CSS is inlined cleanly with zero render-blocking local <link rel="stylesheet">
    assert.doesNotMatch(
      html,
      /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']\/assets\/[^"']+\.css["']/i,
      'Local stylesheet must be inlined into <head>, not linked as render-blocking CSS'
    );
    assert.match(html, /<style>[\s\S]*--c-canvas[\s\S]*<\/style>/, 'Inlined Moss theme CSS must appear in <head>');

    // Verify landing entry does not preload React or Studio chunks
    assert.doesNotMatch(
      html,
      /<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']\/assets\/(?:vendor-|studio-|App-)[^"']+["']/i,
      'Landing index.html must not preload React or heavy Studio chunks'
    );

    // Verify landing entry script chunk is zero-React & ultra-compact (< 40 KB raw)
    const entryScriptMatch = html.match(/<script type="module"[^>]+src="\/assets\/(index-[^"]+\.js)"/);
    assert.ok(entryScriptMatch, 'Built index.html must reference Vite entry script chunk');
    const entrySizeBytes = fs.statSync(path.join(publicDir, 'assets', entryScriptMatch[1])).size;
    assert.ok(
      entrySizeBytes < 40 * 1024,
      `Expected zero-React landing entry JS < 40 KB, got ${Math.round(entrySizeBytes / 1024)} KB`
    );
  });

  test('dist/public PNG assets have valid headers and exact target dimensions', () => {
    const publicDir = path.resolve(process.cwd(), 'dist/public');
    const ogDims = readPngDimensions(path.join(publicDir, 'og-image.png'));
    assert.equal(ogDims.width, 1200);
    assert.equal(ogDims.height, 630);

    const appleDims = readPngDimensions(path.join(publicDir, 'apple-touch-icon.png'));
    assert.equal(appleDims.width, 180);
    assert.equal(appleDims.height, 180);
  });

  test('vercel.json rewrites & local/cloud HTTP servers serve robots.txt, sitemap.xml, llms.txt, manifest.webmanifest, and og-image.png cleanly', async () => {
    const vercelCfg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
    ) as { rewrites: Array<{ source: string; destination: string }> };
    const spaRule = vercelCfg.rewrites.find((r) => r.destination === '/index.html');
    assert.ok(spaRule, 'vercel.json must have SPA rewrite to /index.html');
    const spaRegex = new RegExp(`^${spaRule.source}$`);

    for (const spaPath of ['/', '/welcome', '/signin', '/artifacts/demo-1', '/s/share-tok']) {
      assert.ok(spaRegex.test(spaPath), `Expected SPA fallback to match ${spaPath}`);
    }
    for (const staticOrApiPath of [
      '/robots.txt',
      '/sitemap.xml',
      '/llms.txt',
      '/manifest.webmanifest',
      '/og-image.png',
      '/apple-touch-icon.png',
      '/favicon.svg',
      '/api/health',
      '/assets/app.js',
    ]) {
      assert.ok(!spaRegex.test(staticOrApiPath), `SPA fallback must NOT intercept ${staticOrApiPath}`);
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-seo-test-'));
    const localDataDir = path.join(tmpRoot, 'local');
    const cloudDataDir = path.join(tmpRoot, 'cloud');
    fs.mkdirSync(localDataDir, { recursive: true });
    fs.mkdirSync(cloudDataDir, { recursive: true });

    const { ArtifactStore } = await import('../src/core/storage.js');
    const localStore = new ArtifactStore(localDataDir);
    const localServer = await startArtifactServer({
      port: 0,
      mode: 'local',
      store: localStore,
    });

    const cloudStore = new SqliteCloudStore(cloudDataDir);
    const tokenService = new CloudTokenService({ dataDir: cloudDataDir });
    const cloudServer = await startArtifactServer({
      port: 0,
      mode: 'cloud',
      cloud: { dataDir: cloudDataDir, cloudStore, tokenService },
    });

    const checks: Array<{ urlPath: string; contentType: string; snippet?: string }> = [
      { urlPath: '/robots.txt', contentType: 'text/plain', snippet: 'Sitemap: https://myartifact.app/sitemap.xml' },
      { urlPath: '/sitemap.xml', contentType: 'application/xml', snippet: '<urlset' },
      { urlPath: '/llms.txt', contentType: 'text/plain', snippet: '# MyArtifact' },
      { urlPath: '/manifest.webmanifest', contentType: 'application/manifest+json', snippet: '"MyArtifact Studio"' },
      { urlPath: '/og-image.png', contentType: 'image/png' },
      { urlPath: '/apple-touch-icon.png', contentType: 'image/png' },
    ];

    try {
      for (const base of [
        `http://127.0.0.1:${localServer.port}`,
        `http://127.0.0.1:${cloudServer.port}`,
      ]) {
        for (const item of checks) {
          const res = await fetch(`${base}${item.urlPath}`);
          assert.equal(res.status, 200, `${base}${item.urlPath} should return 200`);
          const ct = res.headers.get('content-type') || '';
          assert.ok(ct.includes(item.contentType), `${item.urlPath} content-type ${ct} should include ${item.contentType}`);
          if (item.snippet) {
            const text = await res.text();
            assert.ok(text.includes(item.snippet), `${item.urlPath} missing expected content`);
            assert.ok(!text.includes('<div id="root"></div>'), `${item.urlPath} must not fall back to SPA index.html`);
          } else {
            const buf = Buffer.from(await res.arrayBuffer());
            assert.equal(buf[0], 0x89);
            assert.equal(buf[1], 0x50);
          }
        }
      }
    } finally {
      await localServer.close();
      localStore.close();
      await cloudServer.close();
      await cloudStore.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
