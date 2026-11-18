import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactStore } from '../src/core/storage.js';
import { startArtifactServer } from '../src/server/server.js';
import { S3CompatibleBlobStore } from '../src/cloud/blob-store.js';
import { SqliteCloudStore } from '../src/cloud/sqlite-cloud-store.js';
import { CloudTokenService, sha256Hex } from '../src/cloud/auth/jwt.js';
import { CredentialVault } from '../src/cli/credentials.js';
import { CloudHttpRepository } from '../src/client/cloud-repository.js';
import { executeMcpTool } from '../src/mcp/mcp-server.js';
import { DEFAULT_AGENT_SCOPE_CEILING } from '../src/core/types.js';

async function startMockS3Server() {
  const objects = new Map<string, Buffer>();
  let presignedPutCount = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const authHeader = req.headers.authorization || '';
    const isPresigned = url.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256';
    const isSigV4Header = authHeader.startsWith('AWS4-HMAC-SHA256');

    if (!isPresigned && !isSigV4Header) {
      res.writeHead(403);
      res.end('Missing AWS SigV4 signature');
      return;
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      objects.set(key, Buffer.concat(chunks));
      if (isPresigned) presignedPutCount++;
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const buf = objects.get(key);
      if (!buf) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(buf);
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(405);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  return {
    endpoint: `http://127.0.0.1:${addr.port}`,
    getPresignedPutCount: () => presignedPutCount,
    getObjectCount: () => objects.size,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('Cloud S3 BlobStore, Local-to-Cloud Migration & MCP Tools over Cloud', () => {
  test('migrates local artifacts, versions, KV storage & S3-presigned TensorBoard checkpoints, and executes MCP tools over Cloud HTTP', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-migrate-test-'));
    const localDir = path.join(tmpRoot, 'local');
    const cloudDir = path.join(tmpRoot, 'cloud');
    const cliDir = path.join(tmpRoot, 'cli');

    const mockS3 = await startMockS3Server();
    const s3BlobStore = new S3CompatibleBlobStore({
      endpoint: mockS3.endpoint,
      region: 'us-east-1',
      bucket: 'myartifact-test-bucket',
      accessKeyId: 'test-ak',
      secretAccessKey: 'test-sk',
      forcePathStyle: true,
    });

    const cloudStore = new SqliteCloudStore(cloudDir, s3BlobStore);
    const tokenService = new CloudTokenService({ dataDir: cloudDir });
    const running = await startArtifactServer({
      port: 0,
      mode: 'cloud',
      cloud: { dataDir: cloudDir, cloudStore, tokenService },
    });
    const localStore = new ArtifactStore(localDir);

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;

      // 1. Populate local store with multi-version artifact + window.storage + TensorBoard checkpoint
      const v1 = localStore.createArtifact({
        slug: 'sim-dashboard',
        title: 'Sim Dashboard',
        type: 'react',
        project: 'argos-01',
        category: 'experiments/benchmarks',
        agent: 'claude-code',
        content: 'export default function App() { return <div>v1</div>; }',
        summary: 'Initial v1',
      });
      localStore.updateArtifact(v1.id, {
        content: 'export default function App() { return <div>v2 chart</div>; }',
        agent: 'antigravity',
        summary: 'Added Recharts view',
      });
      localStore.setStorageValue(v1.id, 'selected_env', 'carpet');

      localStore.logTensorBoardScalars({
        slug: 'qwen-grpo-run',
        title: 'Qwen GRPO Run',
        step: 100,
        metrics: { 'train/reward': 0.84, 'train/loss': 0.31 },
      });
      const weightPayload = Buffer.from('SAFETENSORS_WEIGHTS_BYTES_V1');
      localStore.saveModelCheckpoint({
        slug: 'qwen-grpo-run',
        name: 'step-100.safetensors',
        step: 100,
        content: weightPayload,
        format: 'safetensors',
        metrics: { 'train/reward': 0.84 },
        isBest: true,
      });

      // 2. Provision cloud user & CLI delegated credentials
      const { user, personalWorkspace } = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-mig',
        email: 'mig@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Migrator',
      });
      const session = await cloudStore.createAuthSession({
        userId: user.id,
        sessionKind: 'cli_delegated',
        refreshTokenHash: sha256Hex('rt_mig'),
        scopeCeiling: [...DEFAULT_AGENT_SCOPE_CEILING],
        defaultWorkspaceId: personalWorkspace.id,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      const jwt = tokenService.signAccessJwt({
        sub: user.id,
        sid: session.id,
        email: user.email,
        hd: user.googleHd,
        sessionKind: 'cli_delegated',
        scopes: [...DEFAULT_AGENT_SCOPE_CEILING],
        ws: personalWorkspace.id,
      });

      const vault = new CredentialVault(cliDir);
      vault.writeCredentials({
        cloudUrl: baseUrl,
        accessToken: jwt,
        refreshToken: 'rt_mig',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        sessionId: session.id,
        sessionKind: 'cli_delegated',
        scopes: [...DEFAULT_AGENT_SCOPE_CEILING],
        defaultWorkspaceId: personalWorkspace.id,
        user,
      });

      const cloudRepo = new CloudHttpRepository({
        cloudUrl: baseUrl,
        vault,
        workspace: personalWorkspace.id,
        agent: 'antigravity',
      });

      // 3. Migrate local store into Cloud + verify S3 presigned upload ran
      const migSummary = await cloudRepo.migrateFromLocalStore(localStore);
      assert.equal(migSummary.artifactsMigrated, 2);
      assert.ok(migSummary.versionsMigrated >= 3);
      assert.equal(migSummary.storageKeysMigrated, 1);
      assert.equal(migSummary.checkpointsMigrated, 1);
      assert.ok(mockS3.getPresignedPutCount() >= 1);
      assert.ok(mockS3.getObjectCount() >= 3);

      // Verify v1 & v2 preserved + KV storage migrated
      const migratedDash = await cloudRepo.getArtifact('sim-dashboard');
      assert.ok(migratedDash);
      assert.equal(migratedDash.currentVersion, 2);
      assert.equal(
        await cloudRepo.getVersionContent('sim-dashboard', 1),
        'export default function App() { return <div>v1</div>; }'
      );
      assert.equal((await cloudRepo.getStorageValue('sim-dashboard', 'selected_env'))?.value, 'carpet');

      // Verify S3 checkpoint download redirect returns exact binary payload
      const ckpts = await cloudRepo.getModelCheckpoints('qwen-grpo-run');
      assert.equal(ckpts.length, 1);
      const dlRes = await fetch(
        `${baseUrl}/api/tensorboard/runs/qwen-grpo-run/checkpoints/${ckpts[0].id}/download`,
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
            'X-MyArtifact-Workspace': personalWorkspace.id,
          },
        }
      );
      assert.equal(dlRes.status, 200);
      assert.equal(await dlRes.text(), 'SAFETENSORS_WEIGHTS_BYTES_V1');

      // 4. Execute MCP tools directly over CloudHttpRepository
      const wikiRes = await executeMcpTool(cloudRepo, 'artifact_wiki_index', {
        project: 'argos-01',
        includeLog: true,
      });
      assert.ok(String(wikiRes.indexMarkdown).includes('sim-dashboard'));

      const mcpCreateRes = await executeMcpTool(cloudRepo, 'artifact_create', {
        slug: 'mcp-cloud-chart',
        title: 'MCP Cloud Chart',
        type: 'react',
        agent: 'codex',
        project: 'argos-01',
        category: 'experiments/benchmarks',
        content: 'export default function Chart() { return <div>Cloud MCP</div>; }',
      });
      const mcpArt = mcpCreateRes.artifact as Record<string, unknown>;
      assert.ok(String(mcpArt.url).startsWith(baseUrl));

      await executeMcpTool(cloudRepo, 'artifact_storage_set', {
        id: 'mcp-cloud-chart',
        key: 'mode',
        value: 'live',
      });
      const mcpGet = await executeMcpTool(cloudRepo, 'artifact_get', {
        id: 'mcp-cloud-chart',
        includeStorage: true,
      });
      assert.equal((mcpGet.storage as Array<{ key: string; value: string }>)[0].value, 'live');
    } finally {
      localStore.close();
      await running.close();
      await cloudStore.close();
      await mockS3.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
