import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ArtifactStore } from '../src/core/storage.js';
import { startArtifactServer } from '../src/server/server.js';
import { executeMcpTool } from '../src/mcp/mcp-server.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-int-test-'));
}

describe('Server REST API, MCP Tools, and Dropzone Watcher', () => {
  test('MCP tools create, update, get, list, and set storage across assistants', async () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const createRes = await executeMcpTool(store, 'artifact_create', {
      title: 'Sprint Velocity Chart',
      slug: 'sprint-velocity',
      type: 'react',
      agent: 'claude-code',
      content: 'export default function Chart() { return <div>v1</div>; }',
      tags: ['velocity', 'agile'],
    });

    const createdArt = createRes.artifact as Record<string, unknown>;
    assert.equal(createdArt.slug, 'sprint-velocity');
    assert.equal(createdArt.currentVersion, 1);

    const updateRes = await executeMcpTool(store, 'artifact_update', {
      id: 'sprint-velocity',
      agent: 'antigravity',
      summary: 'Added burndown overlay',
      content: 'export default function Chart() { return <div>v2</div>; }',
    });
    const updatedArt = updateRes.artifact as Record<string, unknown>;
    assert.equal(updatedArt.currentVersion, 2);

    await executeMcpTool(store, 'artifact_storage_set', {
      id: 'sprint-velocity',
      key: 'selected_sprint',
      value: 'Sprint-42',
    });

    const getRes = await executeMcpTool(store, 'artifact_get', {
      id: 'sprint-velocity',
      version: 1,
      includeStorage: true,
    });
    const gotArt = getRes.artifact as Record<string, unknown>;
    assert.equal(gotArt.content, 'export default function Chart() { return <div>v1</div>; }');
    const storageList = getRes.storage as Array<{ key: string; value: string }>;
    assert.equal(storageList.length, 1);
    assert.equal(storageList[0].value, 'Sprint-42');

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('HTTP server serves artifacts, version diffs, storage API, and standalone export', async () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);
    const running = await startArtifactServer({
      port: 0,
      store,
      enableWatcher: false,
    });

    const baseUrl = `http://127.0.0.1:${running.port}`;

    // Create via POST /api/artifacts
    const postRes = await fetch(`${baseUrl}/api/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'codex-viz',
        title: 'Codex Visualizer',
        type: 'react',
        agent: 'codex',
        content: 'export default function Viz() { return <h1>Line 1</h1>; }',
      }),
    });
    assert.equal(postRes.status, 201);

    // Update via PUT /api/artifacts/codex-viz
    const putRes = await fetch(`${baseUrl}/api/artifacts/codex-viz`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'export default function Viz() { return <h1>Line 2 Updated</h1>; }',
        agent: 'antigravity',
        summary: 'Updated heading',
      }),
    });
    assert.equal(putRes.status, 200);

    // Check diff endpoint
    const diffRes = await fetch(`${baseUrl}/api/artifacts/codex-viz/diff?from=1&to=2`);
    const diffData = await diffRes.json();
    assert.ok(diffData.patch.includes('-export default function Viz() { return <h1>Line 1</h1>; }'));
    assert.ok(
      diffData.patch.includes('+export default function Viz() { return <h1>Line 2 Updated</h1>; }')
    );

    // Check standalone HTML export
    const exportRes = await fetch(`${baseUrl}/api/artifacts/codex-viz/export`);
    assert.equal(exportRes.status, 200);
    const exportedHtml = await exportRes.text();
    assert.ok(exportedHtml.includes('window.storage'));
    assert.ok(exportedHtml.includes('lucide-react'));

    await running.close();
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('Dropzone file watcher auto-creates and versions dropped files', async () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);
    const running = await startArtifactServer({
      port: 0,
      store,
      enableWatcher: true,
    });

    // Wait briefly for chokidar ready
    await new Promise((r) => setTimeout(r, 200));

    const droppedFile = path.join(store.dropzoneDir, 'live-widget.tsx');
    fs.writeFileSync(
      droppedFile,
      '// @title: Watched Live Widget\n// @agent: claude-code\nexport default function W() { return <div>v1</div>; }',
      'utf8'
    );

    // Wait for watcher debounce
    await new Promise((r) => setTimeout(r, 350));

    const created = store.getArtifact('live-widget');
    assert.ok(created);
    assert.equal(created.title, 'Watched Live Widget');
    assert.equal(created.agent, 'claude-code');
    assert.equal(created.currentVersion, 1);

    // Modify file in dropzone -> should increment to v2
    fs.writeFileSync(
      droppedFile,
      '// @title: Watched Live Widget\n// @agent: antigravity\nexport default function W() { return <div>v2</div>; }',
      'utf8'
    );

    await new Promise((r) => setTimeout(r, 350));

    const updated = store.getArtifact('live-widget');
    assert.ok(updated);
    assert.equal(updated.currentVersion, 2);

    await running.close();
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
