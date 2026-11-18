import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ArtifactStore } from '../src/core/storage.js';
import { openSqliteDatabase } from '../src/core/db.js';
import { parseTfEventsBuffer } from '../src/core/tensorboard.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-storage-test-'));
}

describe('ArtifactStore Hybrid Storage, Versioning & window.storage', () => {
  test('creates artifact on disk and indexes in SQLite with v1 checkpoint', () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const art = store.createArtifact({
      title: 'Revenue Breakdown',
      content: 'export default function App() { return <div>v1</div>; }',
      type: 'react',
      agent: 'claude-code',
      project: 'finance',
      tags: ['react', 'chart'],
    });

    assert.equal(art.slug, 'revenue-breakdown');
    assert.equal(art.currentVersion, 1);
    assert.equal(art.agent, 'claude-code');
    assert.equal(art.versions.length, 1);
    assert.ok(fs.existsSync(art.filePath));
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'artifacts', 'revenue-breakdown', 'meta.json'))
    );
    assert.ok(
      fs.existsSync(
        path.join(tmpDir, 'artifacts', 'revenue-breakdown', 'versions', 'v1.tsx')
      )
    );

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('updates artifact to v2, preserves v1, and supports rollback to v1 as v3', () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const v1 = store.createArtifact({
      slug: 'arch-diagram',
      title: 'System Diagram',
      type: 'mermaid',
      content: 'flowchart LR\n  A --> B',
      agent: 'antigravity',
    });
    assert.equal(v1.currentVersion, 1);

    const v2 = store.updateArtifact('arch-diagram', {
      content: 'flowchart LR\n  A --> B --> C',
      agent: 'codex',
      summary: 'Added node C',
    });
    assert.equal(v2.currentVersion, 2);
    assert.equal(v2.agent, 'codex');
    assert.equal(store.getVersionContent('arch-diagram', 1), 'flowchart LR\n  A --> B');
    assert.equal(
      store.getVersionContent('arch-diagram', 2),
      'flowchart LR\n  A --> B --> C'
    );

    const v3 = store.rollbackArtifact('arch-diagram', 1, 'antigravity');
    assert.equal(v3.currentVersion, 3);
    assert.equal(v3.content, 'flowchart LR\n  A --> B');

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('supports full-text search (FTS5) and filtering by assistant', () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    store.createArtifact({
      title: 'Kubernetes Cluster Topology',
      content: 'flowchart TD\n  Ingress --> Service',
      type: 'mermaid',
      agent: 'claude-code',
      tags: ['k8s', 'infra'],
    });

    store.createArtifact({
      title: 'Token Cost Optimizer',
      content: 'export default function Optimizer() { return <div>Recharts</div>; }',
      type: 'react',
      agent: 'antigravity',
      tags: ['llm', 'pricing'],
    });

    const k8sResults = store.listArtifacts({ query: 'Kubernetes' });
    assert.equal(k8sResults.length, 1);
    assert.equal(k8sResults[0].agent, 'claude-code');

    const agResults = store.listArtifacts({ agent: 'antigravity' });
    assert.equal(agResults.length, 1);
    assert.equal(agResults[0].title, 'Token Cost Optimizer');

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('persists window.storage key-value entries to SQLite and state.json', () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const art = store.createArtifact({
      slug: 'todo-widget',
      title: 'Todo Widget',
      type: 'react',
      content: 'export default function Todo() {}',
    });

    store.setStorageValue(art.id, 'theme', 'dark');
    store.setStorageValue(art.id, 'note:1', 'Ship local artifact studio');
    store.setStorageValue(art.id, 'note:2', 'Verify MCP tools');

    const themeVal = store.getStorageValue(art.id, 'theme');
    assert.deepEqual(themeVal, { key: 'theme', value: 'dark' });

    const noteKeys = store.listStorageKeys(art.id, 'note:');
    assert.deepEqual(noteKeys.keys, ['note:1', 'note:2']);

    const stateJsonPath = path.join(tmpDir, 'artifacts', 'todo-widget', 'state.json');
    assert.ok(fs.existsSync(stateJsonPath));
    const onDisk = JSON.parse(fs.readFileSync(stateJsonPath, 'utf8'));
    assert.equal(onDisk['note:1'], 'Ship local artifact studio');

    const delRes = store.deleteStorageValue(art.id, 'note:1');
    assert.equal(delRes.deleted, true);
    assert.equal(store.getStorageValue(art.id, 'note:1'), null);

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('logs TensorBoard scalars to .tfevents and versions saved model checkpoints', () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const run1 = store.logTensorBoardScalars({
      slug: 'resnet-cifar10',
      title: 'ResNet-18 CIFAR10 Run',
      modelName: 'ResNet-18',
      framework: 'pytorch',
      hparams: { lr: 0.001, batch_size: 128 },
      step: 100,
      epoch: 1,
      metrics: { 'train/loss': 1.25, 'val/acc': 0.68 },
    });
    assert.equal(run1.type, 'tensorboard');
    assert.equal(run1.currentVersion, 1);

    // Save a trained model checkpoint -> creates v2
    const dummyWeights = Buffer.from('FAKE_SAFETENSORS_WEIGHTS_V1');
    const saved = store.saveModelCheckpoint({
      slug: 'resnet-cifar10',
      name: 'resnet18-best.safetensors',
      step: 200,
      epoch: 2,
      content: dummyWeights,
      format: 'safetensors',
      metrics: { 'val/loss': 0.54, 'val/acc': 0.89 },
      isBest: true,
      agent: 'antigravity',
    });

    assert.equal(saved.artifact.currentVersion, 2);
    assert.equal(saved.checkpoint.isBest, true);
    assert.equal(saved.checkpoint.byteSize, dummyWeights.byteLength);
    assert.ok(fs.existsSync(saved.checkpoint.filePath));

    // Verify genuine binary .tfevents file was written and round-trips cleanly
    const runDir = path.join(store.runsDir, 'resnet-cifar10');
    const eventFiles = fs
      .readdirSync(runDir)
      .filter((f) => f.includes('.tfevents.'));
    assert.equal(eventFiles.length, 1);

    const rawBytes = fs.readFileSync(path.join(runDir, eventFiles[0]));
    const decodedPoints = parseTfEventsBuffer(rawBytes);
    assert.equal(decodedPoints.length, 2);
    assert.equal(decodedPoints[0].tag, 'train/loss');
    assert.equal(decodedPoints[0].step, 100);
    assert.ok(Math.abs(decodedPoints[0].value - 1.25) < 1e-5);

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('resolves foreign host/container file_path prefixes for artifacts and TensorBoard checkpoints', () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const art = store.createArtifact({
      slug: 'cross-mount-demo',
      title: 'Cross Mount Demo',
      type: 'react',
      content: 'export default function Demo() { return <div>Mounted</div>; }',
    });

    const { checkpoint } = store.saveModelCheckpoint({
      slug: 'cross-mount-tb',
      name: 'weights.safetensors',
      step: 10,
      content: Buffer.from('WEIGHTS_BYTES'),
    });

    const rawDb = openSqliteDatabase(path.join(tmpDir, 'index.sqlite'));
    rawDb
      .prepare('UPDATE artifacts SET file_path = ? WHERE id = ?')
      .run('/host/other/home/.myartifact/artifacts/cross-mount-demo/current.tsx', art.id);
    rawDb
      .prepare('UPDATE artifact_versions SET file_path = ? WHERE artifact_id = ?')
      .run('/host/other/home/.myartifact/artifacts/cross-mount-demo/versions/v1.tsx', art.id);
    rawDb
      .prepare('UPDATE tb_checkpoints SET file_path = ? WHERE id = ?')
      .run('/host/other/home/.myartifact/runs/cross-mount-tb/checkpoints/weights.safetensors', checkpoint.id);
    rawDb.close();

    const loaded = store.getArtifact('cross-mount-demo');
    assert.ok(loaded);
    assert.equal(loaded.content, 'export default function Demo() { return <div>Mounted</div>; }');
    assert.equal(
      store.getVersionContent('cross-mount-demo', 1),
      'export default function Demo() { return <div>Mounted</div>; }'
    );

    const loadedCkpt = store.getModelCheckpointById(checkpoint.id);
    assert.ok(loadedCkpt);
    assert.ok(fs.existsSync(loadedCkpt.filePath));
    assert.equal(fs.readFileSync(loadedCkpt.filePath, 'utf8'), 'WEIGHTS_BYTES');

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
