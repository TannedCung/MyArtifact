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

async function waitFor<T>(
  check: () => T | null | undefined | false,
  timeoutMs = 2500,
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

    try {
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

      // Check TensorBoard scalar logging & model checkpoint saving endpoints
      const tbScalarRes = await fetch(`${baseUrl}/api/tensorboard/runs/llama-ft/scalars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'LLaMA Fine-Tune',
          step: 50,
          metrics: { 'train/loss': 0.92, 'val/loss': 0.88 },
        }),
      });
      assert.equal(tbScalarRes.status, 200);

      const tbCkptRes = await fetch(`${baseUrl}/api/tensorboard/runs/llama-ft/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'model-step-50.safetensors',
          step: 50,
          content: 'MODEL_WEIGHTS_PAYLOAD',
          metrics: { 'val/loss': 0.88 },
          isBest: true,
        }),
      });
      assert.equal(tbCkptRes.status, 201);
      const tbCkptData = await tbCkptRes.json();
      assert.equal(tbCkptData.artifact.currentVersion, 2);

      const dlRes = await fetch(
        `${baseUrl}/api/tensorboard/runs/llama-ft/checkpoints/${tbCkptData.checkpoint.id}/download`
      );
      assert.equal(dlRes.status, 200);
      assert.equal(await dlRes.text(), 'MODEL_WEIGHTS_PAYLOAD');
    } finally {
      await running.close();
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Dropzone file watcher auto-creates and versions dropped files', async () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);
    const running = await startArtifactServer({
      port: 0,
      store,
      enableWatcher: true,
    });

    try {
      // Allow chokidar initial watcher scan to settle
      await new Promise((r) => setTimeout(r, 350));

      const droppedFile = path.join(store.dropzoneDir, 'live-widget.tsx');
      fs.writeFileSync(
        droppedFile,
        '// @title: Watched Live Widget\n// @agent: claude-code\nexport default function W() { return <div>v1</div>; }',
        'utf8'
      );

      const created = await waitFor(() => store.getArtifact('live-widget'));
      assert.equal(created.title, 'Watched Live Widget');
      assert.equal(created.agent, 'claude-code');
      assert.equal(created.currentVersion, 1);

      // Modify file in dropzone -> should increment to v2
      fs.writeFileSync(
        droppedFile,
        '// @title: Watched Live Widget\n// @agent: antigravity\nexport default function W() { return <div>v2</div>; }',
        'utf8'
      );

      const updated = await waitFor(() => {
        const art = store.getArtifact('live-widget');
        return art && art.currentVersion >= 2 ? art : null;
      });
      assert.equal(updated.currentVersion, 2);
    } finally {
      await running.close();
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('MCP nudges visual-first on dense Markdown tables and cleanly upgrades v1 markdown -> v2 react', async () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);

    const mdTable = [
      '# Sim-to-Real Benchmark',
      '',
      '| Scenario | Policy | Torque |',
      '| :--- | :--- | ---: |',
      '| s1 | p1 | 2.21 |',
      '| s2 | p1 | 2.28 |',
      '| s3 | p1 | 2.35 |',
      '| s4 | p1 | 2.45 |',
      '| s5 | p1 | 2.19 |',
      '| s6 | p1 | 2.12 |',
    ].join('\n');

    const v1Res = await executeMcpTool(store, 'artifact_create', {
      title: 'Sim-to-Real Benchmark',
      slug: 'sim2real-bench',
      type: 'markdown',
      project: 'argos-01',
      category: 'experiments/benchmarks',
      agent: 'antigravity',
      content: mdTable,
    });

    assert.ok(typeof v1Res.visualRecommendation === 'string');
    assert.ok(String(v1Res.visualRecommendation).includes('6 table data rows'));
    const artifactDir = path.join(store.artifactsDir, 'sim2real-bench');
    assert.ok(fs.existsSync(path.join(artifactDir, 'current.md')));

    // Upgrade v1 (markdown) -> v2 (react)
    const v2Res = await executeMcpTool(store, 'artifact_update', {
      id: 'sim2real-bench',
      type: 'react',
      agent: 'antigravity',
      summary: 'Upgrade benchmark table to interactive Recharts dashboard',
      content: 'import React from "react"; export default function App() { return <div>Chart</div>; }',
    });

    assert.equal(v2Res.visualRecommendation, undefined);
    const v2Art = v2Res.artifact as Record<string, unknown>;
    assert.equal(v2Art.type, 'react');
    assert.equal(v2Art.currentVersion, 2);
    assert.ok(!fs.existsSync(path.join(artifactDir, 'current.md')));
    assert.ok(fs.existsSync(path.join(artifactDir, 'current.tsx')));
    assert.ok(fs.existsSync(path.join(artifactDir, 'versions', 'v1.md')));
    assert.ok(fs.existsSync(path.join(artifactDir, 'versions', 'v2.tsx')));

    // Rollback to v1 restores markdown type cleanly
    const rolledBack = store.rollbackArtifact('sim2real-bench', 1, 'user');
    assert.equal(rolledBack.type, 'markdown');
    assert.equal(rolledBack.currentVersion, 3);
    assert.ok(fs.existsSync(path.join(artifactDir, 'current.md')));
    assert.ok(!fs.existsSync(path.join(artifactDir, 'current.tsx')));

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('Sandbox export includes Three.js addons/R3F importmaps and scene-3d icon preset', async () => {
    const tmpDir = createTempDir();
    const store = new ArtifactStore(tmpDir);
    const running = await startArtifactServer({
      port: 0,
      store,
      enableWatcher: false,
    });

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;

      // 1. React 3D artifact export + scene-3d icon
      await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'demo-3d-react',
          title: 'Demo 3D Scene',
          type: 'react',
          icon: 'scene-3d',
          content: 'import * as THREE from "three"; export default function Scene() { return <div />; }',
        }),
      });

      const reactExport = await (await fetch(`${baseUrl}/api/artifacts/demo-3d-react/export`)).text();
      assert.ok(reactExport.includes('"three/addons/"'));
      assert.ok(reactExport.includes('"@react-three/fiber"'));
      assert.ok(reactExport.includes('"@react-three/drei"'));

      const iconRes = await fetch(`${baseUrl}/api/artifacts/demo-3d-react/icon.svg`);
      assert.equal(iconRes.status, 200);
      const iconSvg = await iconRes.text();
      assert.ok(iconSvg.includes('<svg') && iconSvg.includes('</svg>'));

      // 2. HTML artifact without custom importmap gets Three.js importmap injected before module scripts
      await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'demo-3d-html-auto',
          title: 'Demo 3D HTML Auto',
          type: 'html',
          content: '<!DOCTYPE html><html><head><title>Auto</title></head><body><script type="module">import * as THREE from "three";</script></body></html>',
        }),
      });

      const htmlAutoExport = await (
        await fetch(`${baseUrl}/api/artifacts/demo-3d-html-auto/export`)
      ).text();
      assert.ok(htmlAutoExport.includes('<script type="importmap">'));
      assert.ok(htmlAutoExport.includes('"three/addons/"'));
      assert.ok(
        htmlAutoExport.indexOf('<script type="importmap">') <
          htmlAutoExport.indexOf('<script type="module">')
      );

      // 3. HTML artifact with existing custom importmap is not duplicated
      await fetch(`${baseUrl}/api/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'demo-3d-html-custom',
          title: 'Demo 3D HTML Custom',
          type: 'html',
          content:
            '<!DOCTYPE html><html><head><script type="importmap">{"imports":{"three":"https://esm.sh/three@0.170.0"}}</script></head><body></body></html>',
        }),
      });

      const htmlCustomExport = await (
        await fetch(`${baseUrl}/api/artifacts/demo-3d-html-custom/export`)
      ).text();
      const importMapMatches = htmlCustomExport.match(/type=["']importmap["']/gi) || [];
      assert.equal(importMapMatches.length, 1);
    } finally {
      await running.close();
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
