import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ArtifactStore } from '../core/storage.js';
import type { ArtifactType } from '../core/types.js';

export async function notifyRunningDaemon(payload: Record<string, unknown>): Promise<void> {
  const port = Number(process.env.MYARTIFACT_PORT || 4173);
  try {
    await fetch(`http://127.0.0.1:${port}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(600),
    });
  } catch {
    // Daemon may not be running; safe to ignore
  }
}

export const MCP_TOOLS = [
  {
    name: 'artifact_create',
    description:
      'Create (or upsert by slug) a local visual artifact (React .tsx/.jsx with Tailwind/Lucide/Recharts, HTML, Markdown, Mermaid, SVG, or Code). Stored privately on disk and rendered in the local MyArtifact UI.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Human-readable title of the artifact' },
        slug: {
          type: 'string',
          description: 'Optional URL-friendly identifier (e.g., "revenue-dashboard")',
        },
        type: {
          type: 'string',
          enum: ['react', 'html', 'markdown', 'mermaid', 'svg', 'tensorboard', 'code'],
          description: 'Artifact format type',
        },
        language: { type: 'string', description: 'Optional code language (e.g., tsx, python)' },
        content: { type: 'string', description: 'Complete source code or document content' },
        description: { type: 'string', description: 'Short summary of the artifact' },
        agent: {
          type: 'string',
          description: 'Creating assistant identifier (e.g., claude-code, codex, antigravity)',
        },
        project: { type: 'string', description: 'Project or workspace name' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable tags',
        },
        icon: {
          type: 'string',
          description:
            'Custom 32x32 SVG logo markup (<svg viewBox="0 0 32 32">...</svg>) or preset id (e.g. "latex-paper", "multi-approach", "grpo-rl", "roadmap-tracker", "coder-eval", "engine-blog", "dashboard", "report", "diagram", "tool", "training") used as the browser tab favicon and header logo when opening this artifact page',
        },
        upsert: {
          type: 'boolean',
          description: 'If true and slug exists, creates a new version instead of a duplicate slug',
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'artifact_update',
    description:
      'Update an existing artifact by ID or slug, creating a new immutable version checkpoint (v2, v3, ...) and hot-reloading the live preview.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID or slug' },
        content: { type: 'string', description: 'Updated full content of the artifact' },
        title: { type: 'string', description: 'Optional updated title' },
        icon: {
          type: 'string',
          description: 'Optional updated 32x32 SVG logo markup or preset id',
        },
        summary: {
          type: 'string',
          description: 'Version commit message describing what changed in this iteration',
        },
        agent: {
          type: 'string',
          description: 'Updating assistant identifier (claude-code, codex, antigravity)',
        },
      },
      required: ['id', 'content'],
    },
  },
  {
    name: 'artifact_get',
    description:
      'Retrieve an artifact by ID or slug, including its source content, version history, and persistent window.storage state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID or slug' },
        version: {
          type: 'number',
          description: 'Optional specific historical version number to retrieve',
        },
        includeStorage: {
          type: 'boolean',
          description: 'Include persistent window.storage key-value entries',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'artifact_list',
    description:
      'Search and list local artifacts across all coding assistants (Claude Code, Codex, Antigravity).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search query across title, tags, code' },
        agent: {
          type: 'string',
          description: 'Filter by assistant (claude-code, codex, antigravity)',
        },
        type: {
          type: 'string',
          enum: ['react', 'html', 'markdown', 'mermaid', 'svg', 'tensorboard', 'code'],
        },
        project: { type: 'string', description: 'Filter by project name' },
        limit: { type: 'number', description: 'Maximum results to return' },
      },
    },
  },
  {
    name: 'artifact_storage_set',
    description:
      'Pre-populate or update a key-value entry in an artifact’s persistent window.storage state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID or slug' },
        key: { type: 'string', description: 'Storage key' },
        value: { type: 'string', description: 'String or JSON-serialized value' },
      },
      required: ['id', 'key', 'value'],
    },
  },
  {
    name: 'tb_log_scalars',
    description:
      'Log training scalar metrics (e.g., train/loss, val/loss, val/accuracy, lr) and hyperparameters to a local TensorBoard run, writing both SQLite and genuine TensorBoard .tfevents records.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Run slug or identifier (e.g., "qwen-lora-run1")' },
        title: { type: 'string', description: 'Optional human-readable title of the training run' },
        step: { type: 'number', description: 'Training step number' },
        epoch: { type: 'number', description: 'Optional training epoch' },
        metrics: {
          type: 'object',
          description: 'Map of metric tag to numeric value (e.g., {"train/loss": 0.42, "val/loss": 0.39})',
        },
        hparams: {
          type: 'object',
          description: 'Optional hyperparameter key-values (lr, batch_size, optimizer, etc.)',
        },
        modelName: { type: 'string', description: 'Model name or architecture' },
        framework: { type: 'string', description: 'ML framework (pytorch, tensorflow, jax)' },
        status: { type: 'string', enum: ['running', 'completed', 'failed'] },
        agent: { type: 'string', description: 'Assistant identifier' },
      },
      required: ['run', 'metrics'],
    },
  },
  {
    name: 'tb_save_checkpoint',
    description:
      'Save and version a trained model checkpoint (.pt, .safetensors, .onnx, .ckpt) under a TensorBoard training run, recording its step, validation metrics, SHA-256 hash, and creating a new artifact version.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Run slug or identifier' },
        name: { type: 'string', description: 'Checkpoint filename (e.g., "best-model.safetensors")' },
        step: { type: 'number', description: 'Training step at which checkpoint was saved' },
        epoch: { type: 'number', description: 'Optional epoch number' },
        sourceFilePath: {
          type: 'string',
          description: 'Optional local path to the model weights file to copy into ~/.myartifact/runs/<run>/checkpoints/',
        },
        format: { type: 'string', description: 'Model file format (safetensors, pt, onnx, ckpt)' },
        metrics: {
          type: 'object',
          description: 'Validation metrics at checkpoint (e.g., {"val/loss": 0.31, "val/acc": 0.94})',
        },
        isBest: { type: 'boolean', description: 'Mark this checkpoint as the best model so far' },
        agent: { type: 'string', description: 'Assistant identifier' },
        summary: { type: 'string', description: 'Optional version commit message' },
      },
      required: ['run'],
    },
  },
] as const;

export async function executeMcpTool(
  store: ArtifactStore,
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'artifact_create': {
      const title = String(args.title || 'Untitled Artifact');
      const content = String(args.content || '');
      const slug = typeof args.slug === 'string' ? args.slug : undefined;
      const upsert = Boolean(args.upsert);
      const input = {
        slug,
        title,
        content,
        type: typeof args.type === 'string' ? (args.type as ArtifactType) : undefined,
        language: typeof args.language === 'string' ? args.language : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
        agent: typeof args.agent === 'string' ? args.agent : 'mcp-agent',
        project: typeof args.project === 'string' ? args.project : 'default',
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        icon: typeof args.icon === 'string' ? args.icon : undefined,
      };

      const artifact =
        upsert && slug ? store.upsertBySlug(slug, input) : store.createArtifact(input);

      const port = process.env.MYARTIFACT_PORT || 4173;
      const artifactPageUrl = `http://127.0.0.1:${port}/artifacts/${artifact.slug}`;
      const studioUrl = `http://127.0.0.1:${port}/?view=studio&artifact=${artifact.slug}`;
      const iconUrl = `http://127.0.0.1:${port}/api/artifacts/${artifact.slug}/icon.svg`;
      await notifyRunningDaemon({ type: 'artifact:created', artifact });
      return {
        report: `Published "${artifact.title}" (v${artifact.currentVersion}, ${artifact.type}). Open artifact page: ${artifactPageUrl}`,
        artifact: {
          id: artifact.id,
          slug: artifact.slug,
          title: artifact.title,
          type: artifact.type,
          agent: artifact.agent,
          currentVersion: artifact.currentVersion,
          filePath: artifact.filePath,
          iconUrl,
          url: artifactPageUrl,
          previewUrl: artifactPageUrl,
          studioUrl,
        },
      };
    }

    case 'artifact_update': {
      const id = String(args.id || '');
      const content = String(args.content || '');
      const artifact = store.updateArtifact(id, {
        content,
        title: typeof args.title === 'string' ? args.title : undefined,
        icon: typeof args.icon === 'string' ? args.icon : undefined,
        summary: typeof args.summary === 'string' ? args.summary : undefined,
        agent: typeof args.agent === 'string' ? args.agent : undefined,
      });

      const port = process.env.MYARTIFACT_PORT || 4173;
      const artifactPageUrl = `http://127.0.0.1:${port}/artifacts/${artifact.slug}`;
      const studioUrl = `http://127.0.0.1:${port}/?view=studio&artifact=${artifact.slug}`;
      const iconUrl = `http://127.0.0.1:${port}/api/artifacts/${artifact.slug}/icon.svg`;
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
      return {
        report: `Updated "${artifact.title}" to v${artifact.currentVersion}. Open artifact page: ${artifactPageUrl}`,
        artifact: {
          id: artifact.id,
          slug: artifact.slug,
          title: artifact.title,
          currentVersion: artifact.currentVersion,
          filePath: artifact.filePath,
          iconUrl,
          url: artifactPageUrl,
          previewUrl: artifactPageUrl,
          studioUrl,
        },
      };
    }

    case 'artifact_get': {
      const id = String(args.id || '');
      const artifact = store.getArtifact(id);
      if (!artifact) {
        throw new Error(`Artifact not found: ${id}`);
      }
      const versionNum = typeof args.version === 'number' ? args.version : undefined;
      const content = versionNum
        ? store.getVersionContent(artifact.id, versionNum) ?? artifact.content
        : artifact.content;
      const storage =
        args.includeStorage !== false ? store.getAllStorageEntries(artifact.id) : undefined;

      return {
        artifact: {
          ...artifact,
          content,
          requestedVersion: versionNum || artifact.currentVersion,
        },
        storage,
      };
    }

    case 'artifact_list': {
      const artifacts = store.listArtifacts({
        query: typeof args.query === 'string' ? args.query : undefined,
        agent: typeof args.agent === 'string' ? args.agent : undefined,
        type: typeof args.type === 'string' ? (args.type as ArtifactType) : undefined,
        project: typeof args.project === 'string' ? args.project : undefined,
        limit: typeof args.limit === 'number' ? args.limit : 50,
      });
      return { artifacts };
    }

    case 'artifact_storage_set': {
      const id = String(args.id || '');
      const key = String(args.key || '');
      const value = String(args.value ?? '');
      const result = store.setStorageValue(id, key, value);
      await notifyRunningDaemon({
        type: 'storage:updated',
        artifactId: id,
        entries: store.getAllStorageEntries(id),
      });
      return { result };
    }

    case 'tb_log_scalars': {
      const slug = String(args.run || 'training-run');
      const artifact = store.logTensorBoardScalars({
        slug,
        title: typeof args.title === 'string' ? args.title : undefined,
        step: typeof args.step === 'number' ? args.step : 0,
        epoch: typeof args.epoch === 'number' ? args.epoch : undefined,
        metrics:
          args.metrics && typeof args.metrics === 'object'
            ? (args.metrics as Record<string, number>)
            : {},
        hparams:
          args.hparams && typeof args.hparams === 'object'
            ? (args.hparams as Record<string, string | number | boolean>)
            : undefined,
        modelName: typeof args.modelName === 'string' ? args.modelName : undefined,
        framework: typeof args.framework === 'string' ? args.framework : undefined,
        status:
          args.status === 'running' || args.status === 'completed' || args.status === 'failed'
            ? args.status
            : undefined,
        agent: typeof args.agent === 'string' ? args.agent : 'mcp-agent',
      });
      const port = process.env.MYARTIFACT_PORT || 4173;
      const artifactPageUrl = `http://127.0.0.1:${port}/artifacts/${artifact.slug}`;
      const studioUrl = `http://127.0.0.1:${port}/?view=studio&artifact=${artifact.slug}`;
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
      return {
        report: `Logged scalars to "${artifact.title}" (v${artifact.currentVersion}). Open artifact page: ${artifactPageUrl}`,
        artifact: {
          id: artifact.id,
          slug: artifact.slug,
          title: artifact.title,
          type: artifact.type,
          currentVersion: artifact.currentVersion,
          url: artifactPageUrl,
          previewUrl: artifactPageUrl,
          studioUrl,
        },
      };
    }

    case 'tb_save_checkpoint': {
      const slug = String(args.run || 'training-run');
      const { artifact, checkpoint } = store.saveModelCheckpoint({
        slug,
        name: typeof args.name === 'string' ? args.name : undefined,
        step: typeof args.step === 'number' ? args.step : 0,
        epoch: typeof args.epoch === 'number' ? args.epoch : undefined,
        sourceFilePath:
          typeof args.sourceFilePath === 'string' ? args.sourceFilePath : undefined,
        format: typeof args.format === 'string' ? args.format : undefined,
        metrics:
          args.metrics && typeof args.metrics === 'object'
            ? (args.metrics as Record<string, number>)
            : undefined,
        isBest: Boolean(args.isBest),
        agent: typeof args.agent === 'string' ? args.agent : 'mcp-agent',
        summary: typeof args.summary === 'string' ? args.summary : undefined,
      });
      const port = process.env.MYARTIFACT_PORT || 4173;
      const artifactPageUrl = `http://127.0.0.1:${port}/artifacts/${artifact.slug}`;
      const studioUrl = `http://127.0.0.1:${port}/?view=studio&artifact=${artifact.slug}`;
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
      return {
        report: `Saved checkpoint "${checkpoint.name}" under "${artifact.title}" (v${artifact.currentVersion}). Open artifact page: ${artifactPageUrl}`,
        artifact: {
          id: artifact.id,
          slug: artifact.slug,
          title: artifact.title,
          currentVersion: artifact.currentVersion,
          url: artifactPageUrl,
          previewUrl: artifactPageUrl,
          studioUrl,
        },
        checkpoint,
      };
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export async function runMcpServer(dataDir?: string): Promise<void> {
  const store = new ArtifactStore(dataDir);
  const server = new Server(
    {
      name: 'myartifact',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...MCP_TOOLS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await executeMcpTool(
        store,
        request.params.name,
        (request.params.arguments as Record<string, unknown>) || {}
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${msg}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
