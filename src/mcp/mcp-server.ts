import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ArtifactStore, evaluateVisualOpportunity } from '../core/storage.js';
import { LocalSqliteRepository, type ArtifactRepository } from '../core/repository.js';
import { resolveRepository } from '../core/resolve-repository.js';
import type { CloudHttpRepository } from '../client/cloud-repository.js';
import type { ArtifactType } from '../core/types.js';

function asRepository(storeOrRepo: ArtifactStore | ArtifactRepository): ArtifactRepository {
  return 'mode' in storeOrRepo ? storeOrRepo : new LocalSqliteRepository(storeOrRepo);
}

function getBaseOriginForRepo(repo: ArtifactRepository): string {
  if (repo.mode === 'cloud' && 'cloudUrl' in repo) {
    return (repo as CloudHttpRepository).cloudUrl;
  }
  const port = process.env.MYARTIFACT_PORT || 4173;
  return `http://127.0.0.1:${port}`;
}

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
      'Create (or upsert by slug) a local interactive visual artifact. VISUAL-FIRST POLICY: Prefer interactive "react" (.tsx/.jsx with Tailwind, Recharts, Three.js / three/addons / @react-three/fiber, Lucide, and inline SVG) or "html" whenever explaining benchmarks, multi-row metric comparisons, 3D kinematics/scenes, system architectures, state machines, hardware pinouts/layouts, or checklists. Reserve plain "markdown" strictly for short narrative notes where charts, 3D viewports, diagrams, or interactive controls do not improve clarity.',
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
          description:
            'Artifact format. Prefer "react" or "html" for visual dashboards, benchmarks, Three.js 3D viewports, hardware/architecture workbenches, and interactive tools; "mermaid"/"svg" for standalone diagrams; reserve "markdown" only for brief narrative notes.',
        },
        language: { type: 'string', description: 'Optional code language (e.g., tsx, python)' },
        content: { type: 'string', description: 'Complete source code or document content' },
        description: {
          type: 'string',
          description:
            'One-line executive summary of the artifact for the LLM Wiki master catalog (index.md)',
        },
        agent: {
          type: 'string',
          description: 'Creating assistant identifier (e.g., claude-code, codex, antigravity)',
        },
        project: { type: 'string', description: 'Project or workspace name' },
        category: {
          type: 'string',
          description:
            'LLM Wiki category path decided by the agent (e.g., "experiments/reasoning", "concepts/architecture", "papers/research", "comparisons/tradeoffs", "roadmaps/platform")',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable tags',
        },
        links: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Related artifact slugs to cross-reference in the LLM Wiki graph (e.g. ["deepseek-r1-grpo-reasoning", "multi-approach-reasoning-tracker"])',
        },
        icon: {
          type: 'string',
          description:
            'Custom 32x32 SVG logo markup (<svg viewBox="0 0 32 32">...</svg>) or preset id (e.g. "scene-3d", "latex-paper", "multi-approach", "grpo-rl", "roadmap-tracker", "coder-eval", "engine-blog", "dashboard", "report", "diagram", "tool", "training") used as the browser tab favicon and header logo when opening this artifact page',
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
      'Update an existing artifact by ID or slug (including upgrading a v1 text/markdown artifact into a v2 interactive react/html visual artifact), creating a new immutable version checkpoint (v2, v3, ...) and hot-reloading the live preview.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID or slug' },
        content: { type: 'string', description: 'Updated full content of the artifact' },
        title: { type: 'string', description: 'Optional updated title' },
        type: {
          type: 'string',
          enum: ['react', 'html', 'markdown', 'mermaid', 'svg', 'tensorboard', 'code'],
          description:
            'Optional updated artifact format (e.g., set to "react" or "html" when upgrading a v1 markdown report into an interactive visual v2)',
        },
        language: {
          type: 'string',
          description: 'Optional updated language (e.g., tsx, html)',
        },
        description: {
          type: 'string',
          description: 'Optional updated 1-line summary for index.md',
        },
        project: {
          type: 'string',
          description: 'Optional updated project slug (e.g., "argos-01", "reasoning-lab", "myartifact")',
        },
        category: {
          type: 'string',
          description: 'Optional updated LLM Wiki category path (e.g., "experiments/reasoning")',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional updated searchable tags',
        },
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional updated related artifact slugs',
        },
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
    name: 'artifact_wiki_index',
    description:
      'Read the LLM Wiki master catalog (~/.myartifact/index.md) grouped by project and category, backlinks graph, and recent operation log (~/.myartifact/log.md). Always call this first before creating a new artifact (to decide project/category placement and cross-links—while choosing interactive "react"/"html" visuals even if older entries in the project used "markdown") or when looking up past experiments and reports.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Optional project slug filter to view only one project in index.md',
        },
        includeLog: {
          type: 'boolean',
          description: 'Also include the recent operation log from log.md',
        },
      },
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
        category: {
          type: 'string',
          description: 'Filter by LLM Wiki category path (e.g., "experiments/reasoning")',
        },
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
  storeOrRepo: ArtifactStore | ArtifactRepository,
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const repo = asRepository(storeOrRepo);
  const baseOrigin = getBaseOriginForRepo(repo);

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
        category: typeof args.category === 'string' ? args.category : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        links: Array.isArray(args.links) ? args.links.map(String) : undefined,
        icon: typeof args.icon === 'string' ? args.icon : undefined,
      };

      const artifact =
        upsert && slug ? await repo.upsertBySlug(slug, input) : await repo.createArtifact(input);

      const artifactPageUrl = `${baseOrigin}/artifacts/${artifact.slug}`;
      const studioUrl = `${baseOrigin}/?view=studio&artifact=${artifact.slug}`;
      const iconUrl = `${baseOrigin}/api/artifacts/${artifact.slug}/icon.svg`;
      const visualRecommendation = evaluateVisualOpportunity({
        type: artifact.type,
        category: artifact.category,
        content: artifact.content,
        title: artifact.title,
      });
      if (repo.mode === 'local') {
        await notifyRunningDaemon({ type: 'artifact:created', artifact });
      }
      return {
        report: `Published "${artifact.title}" (v${artifact.currentVersion}, ${artifact.type}) in [${artifact.project} / ${artifact.category}]. Open artifact page: ${artifactPageUrl}${visualRecommendation ? ` | ${visualRecommendation}` : ''}`,
        ...(visualRecommendation ? { visualRecommendation } : {}),
        artifact: {
          id: artifact.id,
          slug: artifact.slug,
          title: artifact.title,
          type: artifact.type,
          project: artifact.project,
          category: artifact.category,
          links: artifact.links,
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
      const artifact = await repo.updateArtifact(id, {
        content,
        title: typeof args.title === 'string' ? args.title : undefined,
        type: typeof args.type === 'string' ? (args.type as ArtifactType) : undefined,
        language: typeof args.language === 'string' ? args.language : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
        project: typeof args.project === 'string' ? args.project : undefined,
        category: typeof args.category === 'string' ? args.category : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        links: Array.isArray(args.links) ? args.links.map(String) : undefined,
        icon: typeof args.icon === 'string' ? args.icon : undefined,
        summary: typeof args.summary === 'string' ? args.summary : undefined,
        agent: typeof args.agent === 'string' ? args.agent : undefined,
      });

      const artifactPageUrl = `${baseOrigin}/artifacts/${artifact.slug}`;
      const studioUrl = `${baseOrigin}/?view=studio&artifact=${artifact.slug}`;
      const iconUrl = `${baseOrigin}/api/artifacts/${artifact.slug}/icon.svg`;
      const visualRecommendation = evaluateVisualOpportunity({
        type: artifact.type,
        category: artifact.category,
        content: artifact.content,
        title: artifact.title,
      });
      if (repo.mode === 'local') {
        await notifyRunningDaemon({ type: 'artifact:updated', artifact });
      }
      return {
        report: `Updated "${artifact.title}" to v${artifact.currentVersion} (${artifact.type}) in [${artifact.project} / ${artifact.category}]. Open artifact page: ${artifactPageUrl}${visualRecommendation ? ` | ${visualRecommendation}` : ''}`,
        ...(visualRecommendation ? { visualRecommendation } : {}),
        artifact: {
          id: artifact.id,
          slug: artifact.slug,
          title: artifact.title,
          type: artifact.type,
          project: artifact.project,
          category: artifact.category,
          links: artifact.links,
          currentVersion: artifact.currentVersion,
          filePath: artifact.filePath,
          iconUrl,
          url: artifactPageUrl,
          previewUrl: artifactPageUrl,
          studioUrl,
        },
      };
    }

    case 'artifact_wiki_index': {
      const projFilter = typeof args.project === 'string' ? args.project : undefined;
      const indexMarkdown = await repo.getWikiIndexMarkdown(projFilter);
      const taxonomy = await repo.getWikiTaxonomy(projFilter);
      const logMarkdown = args.includeLog ? await repo.getWikiLogMarkdown() : undefined;
      return {
        ...taxonomy,
        indexMarkdown,
        ...(logMarkdown !== undefined ? { logMarkdown } : {}),
      };
    }

    case 'artifact_get': {
      const id = String(args.id || '');
      const artifact = await repo.getArtifact(id);
      if (!artifact) {
        throw new Error(`Artifact not found: ${id}`);
      }
      const versionNum = typeof args.version === 'number' ? args.version : undefined;
      const content = versionNum
        ? (await repo.getVersionContent(artifact.id, versionNum)) ?? artifact.content
        : artifact.content;
      const storage =
        args.includeStorage !== false ? await repo.getAllStorageEntries(artifact.id) : undefined;

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
      const artifacts = await repo.listArtifacts({
        query: typeof args.query === 'string' ? args.query : undefined,
        agent: typeof args.agent === 'string' ? args.agent : undefined,
        type: typeof args.type === 'string' ? (args.type as ArtifactType) : undefined,
        project: typeof args.project === 'string' ? args.project : undefined,
        category: typeof args.category === 'string' ? args.category : undefined,
        limit: typeof args.limit === 'number' ? args.limit : 50,
      });
      return { artifacts };
    }

    case 'artifact_storage_set': {
      const id = String(args.id || '');
      const key = String(args.key || '');
      const value = String(args.value ?? '');
      const result = await repo.setStorageValue(id, key, value);
      if (repo.mode === 'local') {
        await notifyRunningDaemon({
          type: 'storage:updated',
          artifactId: id,
          entries: await repo.getAllStorageEntries(id),
        });
      }
      return { result };
    }

    case 'tb_log_scalars': {
      const slug = String(args.run || 'training-run');
      const artifact = await repo.logTensorBoardScalars({
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
      const artifactPageUrl = `${baseOrigin}/artifacts/${artifact.slug}`;
      const studioUrl = `${baseOrigin}/?view=studio&artifact=${artifact.slug}`;
      if (repo.mode === 'local') {
        await notifyRunningDaemon({ type: 'artifact:updated', artifact });
      }
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
      const { artifact, checkpoint } = await repo.saveModelCheckpoint({
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
      const artifactPageUrl = `${baseOrigin}/artifacts/${artifact.slug}`;
      const studioUrl = `${baseOrigin}/?view=studio&artifact=${artifact.slug}`;
      if (repo.mode === 'local') {
        await notifyRunningDaemon({ type: 'artifact:updated', artifact });
      }
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
  const repo = resolveRepository({
    dataDir,
    agent: process.env.MYARTIFACT_AGENT || 'mcp-agent',
  });
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
        repo,
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
