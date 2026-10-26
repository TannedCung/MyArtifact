#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {
  ArtifactStore,
  inferTypeFromPathOrContent,
  slugify,
} from '../core/storage.js';
import { seedStarterArtifacts } from '../core/seed.js';
import { startArtifactServer } from '../server/server.js';
import { runMcpServer, notifyRunningDaemon } from '../mcp/mcp-server.js';
import { installAgentIntegrations } from '../integrations/installer.js';
import type { ArtifactType } from '../core/types.js';

const program = new Command();

program
  .name('myartifact')
  .enablePositionalOptions()
  .description(
    'Local, private, cross-assistant visual artifact platform for Claude Code, Codex, and Antigravity'
  )
  .version('1.0.0');

program
  .command('serve')
  .description('Start the local MyArtifact web UI, REST/WebSocket daemon, and file watcher')
  .option('-p, --port <port>', 'Port to listen on', process.env.MYARTIFACT_PORT || '4173')
  .option('-H, --host <host>', 'Host to bind to', process.env.MYARTIFACT_HOST || '127.0.0.1')
  .option('-d, --data-dir <dir>', 'Custom storage directory (default: ~/.myartifact)')
  .option('-w, --watch <dirs...>', 'Additional directories to watch for artifact files')
  .option('--no-seed', 'Do not seed starter artifacts when database is empty')
  .action(async (opts) => {
    const store = new ArtifactStore(opts.dataDir);
    if (opts.seed !== false) {
      seedStarterArtifacts(store);
    }
    const running = await startArtifactServer({
      port: Number(opts.port),
      host: opts.host,
      store,
      watchDirs: opts.watch || [],
    });
    console.log(`\n✨ MyArtifact Local Workspace is running!`);
    console.log(`   ➜ Web UI:    http://${running.host}:${running.port}`);
    console.log(`   ➜ Data Dir:  ${store.dataDir}`);
    console.log(`   ➜ Dropzone:  ${store.dropzoneDir}`);
    console.log(`   ➜ TB Runs:   ${store.runsDir}\n`);
  });

program
  .command('push [file]')
  .description('Create or update an artifact from a local file (incrementing version if slug exists)')
  .option('-i, --id <slug>', 'Artifact slug or ID (auto-derived from filename/title if omitted)')
  .option('-t, --title <title>', 'Artifact title')
  .option(
    '--type <type>',
    'Artifact type (react | html | markdown | mermaid | svg | code)'
  )
  .option('-a, --agent <agent>', 'Assistant name (claude-code | codex | antigravity | user)', 'user')
  .option('-p, --project <project>', 'Project name', 'default')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-s, --summary <summary>', 'Version commit message / summary')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (file, opts) => {
    if (!file) {
      console.error('Error: Please provide a file path to push.');
      process.exit(1);
    }
    const resolvedPath = path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: File not found: ${resolvedPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const inferred = inferTypeFromPathOrContent(resolvedPath, content);
    const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
    const slug = opts.id || slugify(opts.title || baseName);
    const title =
      opts.title ||
      baseName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const tags = opts.tags
      ? String(opts.tags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [opts.type || inferred.type];

    const store = new ArtifactStore(opts.dataDir);
    const artifact = store.upsertBySlug(slug, {
      title,
      type: (opts.type as ArtifactType) || inferred.type,
      language: inferred.language,
      content,
      agent: opts.agent,
      project: opts.project,
      tags,
      summary: opts.summary,
    });

    await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    store.close();

    console.log(
      `✅ Synced artifact "${artifact.title}" (${artifact.slug}) -> v${artifact.currentVersion} [${artifact.type}]`
    );
    console.log(`   File: ${artifact.filePath}`);
  });

program
  .command('list')
  .description('List and search stored local artifacts across assistants')
  .option('-q, --query <query>', 'Full-text search query')
  .option('-a, --agent <agent>', 'Filter by agent (claude-code | codex | antigravity)')
  .option('--type <type>', 'Filter by artifact type')
  .option('-p, --project <project>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action((opts) => {
    const store = new ArtifactStore(opts.dataDir);
    const list = store.listArtifacts({
      query: opts.query,
      agent: opts.agent,
      type: opts.type as ArtifactType,
      project: opts.project,
    });
    store.close();

    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }

    if (list.length === 0) {
      console.log('No artifacts found.');
      return;
    }

    for (const item of list) {
      console.log(
        `• [${item.slug}] v${item.currentVersion} (${item.type} | ${item.agent}) — ${item.title}`
      );
    }
  });

program
  .command('get <id>')
  .description('Get an artifact’s source code or metadata by ID or slug')
  .option('-v, --version <version>', 'Specific version number to retrieve')
  .option('--json', 'Output full metadata + storage as JSON')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action((id, opts) => {
    const store = new ArtifactStore(opts.dataDir);
    const artifact = store.getArtifact(id);
    if (!artifact) {
      store.close();
      console.error(`Error: Artifact not found: ${id}`);
      process.exit(1);
    }

    const versionNum = opts.version ? Number(opts.version) : artifact.currentVersion;
    const content = opts.version
      ? store.getVersionContent(artifact.id, versionNum)
      : artifact.content;
    const storage = store.getAllStorageEntries(artifact.id);
    store.close();

    if (content === null) {
      console.error(`Error: Version ${versionNum} not found for ${id}`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(
        JSON.stringify({ artifact: { ...artifact, content }, version: versionNum, storage }, null, 2)
      );
    } else {
      process.stdout.write(content);
    }
  });

program
  .command('mcp')
  .description('Start the MyArtifact MCP server over stdio for Claude Code, Codex, and Antigravity')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    await runMcpServer(opts.dataDir);
  });

program
  .command('setup')
  .description('Install MyArtifact skills (SKILL.md) and MCP config for Antigravity, Claude Code, and Codex')
  .option('-t, --target <dir>', 'Workspace directory to configure', process.cwd())
  .option('-g, --global', 'Also install into global ~/.gemini, ~/.claude, and ~/.codex skill directories')
  .action((opts) => {
    const result = installAgentIntegrations({
      targetDir: opts.target,
      global: Boolean(opts.global),
    });
    console.log('✅ Installed MyArtifact skills & MCP configurations:');
    for (const f of result.writtenFiles) {
      console.log(`   • ${f}`);
    }
  });

const tbCmd = program
  .command('tb')
  .description('TensorBoard training run & model checkpoint commands');

tbCmd
  .command('log <run>')
  .description('Log scalar training metrics to a local TensorBoard run (.tfevents + SQLite)')
  .option('-s, --step <step>', 'Training step number', '0')
  .option('-e, --epoch <epoch>', 'Training epoch number')
  .option('-m, --metric <items...>', 'Metric key=value pairs (e.g. train/loss=0.42 val/acc=0.91)')
  .option('-t, --title <title>', 'Run title')
  .option('--model <model>', 'Model architecture name')
  .option('--framework <framework>', 'Framework (pytorch | tensorflow | jax)', 'pytorch')
  .option('--status <status>', 'Run status (running | completed | failed)')
  .option('-a, --agent <agent>', 'Assistant name', 'user')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (run, opts) => {
    const metrics: Record<string, number> = {};
    for (const item of opts.metric || []) {
      const [k, v] = String(item).split('=');
      if (k && v !== undefined && !Number.isNaN(Number(v))) {
        metrics[k.trim()] = Number(v);
      }
    }
    const store = new ArtifactStore(opts.dataDir);
    const artifact = store.logTensorBoardScalars({
      slug: run,
      title: opts.title,
      modelName: opts.model,
      framework: opts.framework,
      status: opts.status,
      agent: opts.agent,
      step: Number(opts.step || 0),
      epoch: opts.epoch !== undefined ? Number(opts.epoch) : undefined,
      metrics,
    });
    await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    store.close();
    console.log(
      `📈 Logged ${Object.keys(metrics).length} scalar(s) at step ${opts.step} to TensorBoard run "${artifact.slug}"`
    );
  });

tbCmd
  .command('save-model <run> [file]')
  .description('Save and version a trained model checkpoint under a TensorBoard run')
  .option('-n, --name <name>', 'Checkpoint filename')
  .option('-s, --step <step>', 'Training step', '0')
  .option('-e, --epoch <epoch>', 'Training epoch')
  .option('-m, --metric <items...>', 'Validation metric key=value pairs (e.g. val/loss=0.31)')
  .option('--best', 'Mark this checkpoint as the best model')
  .option('-a, --agent <agent>', 'Assistant name', 'user')
  .option('--summary <summary>', 'Version commit message')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (run, file, opts) => {
    const metrics: Record<string, number> = {};
    for (const item of opts.metric || []) {
      const [k, v] = String(item).split('=');
      if (k && v !== undefined && !Number.isNaN(Number(v))) {
        metrics[k.trim()] = Number(v);
      }
    }
    const store = new ArtifactStore(opts.dataDir);
    const { artifact, checkpoint } = store.saveModelCheckpoint({
      slug: run,
      name: opts.name,
      step: Number(opts.step || 0),
      epoch: opts.epoch !== undefined ? Number(opts.epoch) : undefined,
      sourceFilePath: file ? path.resolve(file) : undefined,
      metrics,
      isBest: Boolean(opts.best),
      agent: opts.agent,
      summary: opts.summary,
    });
    await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    store.close();
    console.log(
      `💾 Saved model checkpoint "${checkpoint.name}" (step ${checkpoint.step}, sha256: ${checkpoint.sha256.slice(0, 10)}…) -> ${artifact.slug} v${artifact.currentVersion}`
    );
  });

tbCmd
  .command('import <file>')
  .description('Import an existing TensorBoard events.out.tfevents.* file')
  .option('-r, --run <slug>', 'Target run slug')
  .option('-t, --title <title>', 'Run title')
  .option('-a, --agent <agent>', 'Assistant name', 'user')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (file, opts) => {
    const store = new ArtifactStore(opts.dataDir);
    const artifact = store.importTfEventsFile(file, {
      slug: opts.run,
      title: opts.title,
      agent: opts.agent,
    });
    await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    store.close();
    console.log(
      `✅ Imported TensorBoard events into "${artifact.title}" (${artifact.slug}) -> v${artifact.currentVersion}`
    );
  });

program.parseAsync(process.argv);
