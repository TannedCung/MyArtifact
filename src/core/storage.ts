import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { initDatabase } from './db.js';
import { resolveArtifactIconSvg } from './icons.js';
import {
  encodeTfEventHeader,
  encodeTfEventScalar,
  getDefaultEventFileName,
  parseTfEventsBuffer,
} from './tensorboard.js';
import type {
  ArtifactDetail,
  ArtifactMetadata,
  ArtifactType,
  ArtifactVersion,
  CreateArtifactInput,
  ListArtifactsFilter,
  LogScalarsInput,
  ModelCheckpoint,
  SaveModelCheckpointInput,
  StorageEntry,
  TensorBoardRunManifest,
  TensorBoardScalarPoint,
  UpdateArtifactInput,
} from './types.js';

const MAX_STORAGE_BYTES = 20 * 1024 * 1024; // 20 MB per artifact (matches Claude Artifacts)

export function getDefaultDataDir(): string {
  if (process.env.MYARTIFACT_HOME) {
    return path.resolve(process.env.MYARTIFACT_HOME);
  }
  return path.join(os.homedir(), '.myartifact');
}

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'artifact';
}

export function getExtensionForType(type: ArtifactType, language?: string): string {
  switch (type) {
    case 'react':
      return '.tsx';
    case 'html':
      return '.html';
    case 'markdown':
      return '.md';
    case 'mermaid':
      return '.mmd';
    case 'svg':
      return '.svg';
    case 'tensorboard':
      return '.tb.json';
    case 'code': {
      const langMap: Record<string, string> = {
        typescript: '.ts',
        ts: '.ts',
        javascript: '.js',
        js: '.js',
        python: '.py',
        py: '.py',
        rust: '.rs',
        go: '.go',
        sql: '.sql',
        json: '.json',
        css: '.css',
        sh: '.sh',
        bash: '.sh',
      };
      const norm = (language || '').toLowerCase();
      return langMap[norm] || '.txt';
    }
  }
}

export function getDefaultLanguageForType(type: ArtifactType): string {
  switch (type) {
    case 'react':
      return 'tsx';
    case 'html':
      return 'html';
    case 'markdown':
      return 'markdown';
    case 'mermaid':
      return 'mermaid';
    case 'svg':
      return 'svg';
    case 'tensorboard':
      return 'tensorboard';
    case 'code':
      return 'text';
  }
}

export function evaluateVisualOpportunity(input: {
  type: ArtifactType;
  category?: string;
  content: string;
  title: string;
}): string | undefined {
  if (input.type !== 'markdown') return undefined;

  const lines = (input.content || '').split(/\r?\n/);
  let inTableData = false;
  let tableDataRows = 0;
  for (const line of lines) {
    const isSeparator = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line);
    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    if (isSeparator) {
      inTableData = true;
    } else if (inTableData && isTableRow) {
      tableDataRows++;
    } else if (!isTableRow) {
      inTableData = false;
    }
  }

  if (tableDataRows >= 5) {
    return `Visual-first recommendation: This Markdown artifact has ${tableDataRows} table data rows. Consider upgrading it (vN+1) to an interactive "react" (.tsx with Recharts charts, ceiling/budget reference lines, and filter pills) or "html" visualizer so patterns and outliers stand out immediately.`;
  }

  const catOrTitle = `${input.category || ''} ${input.title}`;
  if (/(benchmark|comparison|experiment|ablation|eval)/i.test(catOrTitle)) {
    return 'Visual-first recommendation: Benchmarks, ablations, and comparisons are easier to follow as an interactive "react" (Recharts bar/line/radar charts + KPI cards) or "tensorboard" artifact rather than plain Markdown text.';
  }

  if (
    /(architecture|fsm|state-machine|pinout|wiring|bring-up|physical-build|roadmap|tracker|3d|spatial|kinematic|mesh|scene)/i.test(
      catOrTitle
    ) ||
    (input.content || '').length >= 4500
  ) {
    return 'Visual-first recommendation: Technical guides, architectures, hardware pinouts, 3D spatial layouts, and trackers communicate faster as an interactive "react" or "html" workbench (Three.js (`three` + `three/addons/`) 3D viewports, inline SVG spatial/pinout diagrams, clickable state steppers, and window.storage checklists) rather than long Markdown prose.';
  }

  return undefined;
}

export function inferTypeFromPathOrContent(filePath?: string, content?: string): {
  type: ArtifactType;
  language: string;
} {
  if (filePath) {
    const baseName = path.basename(filePath).toLowerCase();
    if (baseName.includes('.tfevents.') || baseName.endsWith('.tb.json')) {
      return { type: 'tensorboard', language: 'tensorboard' };
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.tsx' || ext === '.jsx') return { type: 'react', language: 'tsx' };
    if (ext === '.html' || ext === '.htm') return { type: 'html', language: 'html' };
    if (ext === '.md' || ext === '.markdown') return { type: 'markdown', language: 'markdown' };
    if (ext === '.mmd' || ext === '.mermaid') return { type: 'mermaid', language: 'mermaid' };
    if (ext === '.svg') return { type: 'svg', language: 'svg' };
    if (ext === '.py') return { type: 'code', language: 'python' };
    if (ext === '.ts') return { type: 'code', language: 'typescript' };
    if (ext === '.js') return { type: 'code', language: 'javascript' };
    if (ext === '.sql') return { type: 'code', language: 'sql' };
    if (ext === '.json') return { type: 'code', language: 'json' };
  }

  const trimmed = (content || '').trim();
  if (trimmed.startsWith('{') && trimmed.includes('"scalars"') && trimmed.includes('"runSlug"')) {
    return { type: 'tensorboard', language: 'tensorboard' };
  }
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) {
    return { type: 'html', language: 'html' };
  }
  if (trimmed.startsWith('<svg')) {
    return { type: 'svg', language: 'svg' };
  }
  if (
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/m.test(
      trimmed
    )
  ) {
    return { type: 'mermaid', language: 'mermaid' };
  }
  if (
    /export\s+default\s+function|import\s+.*from\s+['"]react['"]|from\s+['"]lucide-react['"]|from\s+['"](?:three|three\/addons\/[^'"]+|@react-three\/fiber)['"]/.test(
      trimmed
    )
  ) {
    return { type: 'react', language: 'tsx' };
  }
  return { type: 'markdown', language: 'markdown' };
}

export function normalizeProjectName(rawProject?: string): string {
  if (!rawProject) return '';
  const cleaned = rawProject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === 'default' ? '' : cleaned;
}

export function inferWikiProject(input: {
  slug: string;
  title: string;
  project?: string;
  tags?: string[];
}): string {
  const explicit = normalizeProjectName(input.project);
  if (explicit) return explicit;

  const hay = `${input.slug} ${input.title} ${(input.tags || []).join(' ')}`.toLowerCase();
  if (hay.includes('argos')) {
    return 'argos-01';
  }
  if (
    hay.includes('grpo') ||
    hay.includes('reasoning') ||
    hay.includes('qwen') ||
    hay.includes('latex') ||
    hay.includes('lora') ||
    hay.includes('llm-cost')
  ) {
    return 'reasoning-lab';
  }
  if (
    hay.includes('myartifact') ||
    hay.includes('artifact-engine') ||
    hay.includes('multi-agent') ||
    hay.includes('telemetry')
  ) {
    return 'myartifact';
  }
  return 'general';
}

export function normalizeWikiCategory(rawCategory?: string): string {
  if (!rawCategory) return '';
  return rawCategory
    .trim()
    .toLowerCase()
    .split(/[\\/]+/)
    .map((seg) =>
      seg
        .trim()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
    .join('/');
}

export function inferWikiCategory(input: {
  slug: string;
  title: string;
  type: ArtifactType;
  tags?: string[];
  category?: string;
  content?: string;
}): string {
  const explicit = normalizeWikiCategory(input.category);
  if (explicit) return explicit;

  if (input.content) {
    const commentMatch = input.content.match(
      /(?:\/\*|<!--)\s*category\s*:\s*([a-zA-Z0-9/_-]+)\s*(?:\*\/|-->)/i
    );
    if (commentMatch && commentMatch[1]) {
      const fromComment = normalizeWikiCategory(commentMatch[1]);
      if (fromComment) return fromComment;
    }
  }

  const hay = `${input.slug} ${input.title} ${(input.tags || []).join(' ')}`.toLowerCase();
  if (hay.includes('latex') || hay.includes('paper') || hay.includes('arxiv') || hay.includes('scaling')) {
    return 'papers/research';
  }
  if (input.type === 'tensorboard' || hay.includes('lora') || hay.includes('finetune') || hay.includes('checkpoint')) {
    return 'experiments/training';
  }
  if (hay.includes('grpo') || hay.includes('reasoning') || hay.includes('multi-approach') || hay.includes('rl')) {
    return 'experiments/reasoning';
  }
  if (hay.includes('eval') || hay.includes('benchmark') || hay.includes('pass@1')) {
    return 'experiments/benchmarks';
  }
  if (hay.includes('cost') || hay.includes('latency') || hay.includes('simulator') || hay.includes('comparison')) {
    return 'comparisons/tradeoffs';
  }
  if (hay.includes('roadmap') || hay.includes('tracker') || hay.includes('telemetry') || hay.includes('milestone')) {
    return 'roadmaps/platform';
  }
  if (
    input.type === 'mermaid' ||
    hay.includes('architecture') ||
    hay.includes('engine') ||
    hay.includes('blog') ||
    hay.includes('design') ||
    hay.includes('three') ||
    hay.includes('3d') ||
    hay.includes('webgl') ||
    hay.includes('kinematic') ||
    hay.includes('scene')
  ) {
    return 'concepts/architecture';
  }
  return 'concepts/general';
}

export function extractWikiLinks(
  content: string,
  explicitLinks?: string[],
  selfSlug?: string
): string[] {
  const found = new Set<string>();
  for (const l of explicitLinks || []) {
    const clean = slugify(l);
    if (clean && clean !== selfSlug) found.add(clean);
  }
  if (content) {
    // Match [[slug]] or [[slug|label]]
    const wikiMatches = content.matchAll(/\[\[([a-z0-9-]{2,64})(?:\|[^\]]+)?\]\]/gi);
    for (const m of wikiMatches) {
      const s = slugify(m[1]);
      if (s && s !== selfSlug) found.add(s);
    }
    // Match /artifacts/<slug>
    const urlMatches = content.matchAll(/\/artifacts\/([a-z0-9-]{2,64})\b/gi);
    for (const m of urlMatches) {
      const s = slugify(m[1]);
      if (s && s !== selfSlug && s !== 'icon') found.add(s);
    }
  }
  return Array.from(found);
}

export function extractAutoDescription(
  description: string | undefined,
  title: string,
  type: ArtifactType,
  content: string
): string {
  if (description && description.trim()) {
    return description.trim().replace(/\s+/g, ' ').slice(0, 280);
  }
  if (!content) return `${title} (${type} artifact)`;

  // Strip style/script/svg blocks and tags for HTML/React
  const stripped = content
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length > 24) {
    return stripped.slice(0, 220) + (stripped.length > 220 ? '…' : '');
  }
  return `${title} (${type} artifact)`;
}

export class ArtifactStore {
  public readonly dataDir: string;
  public readonly artifactsDir: string;
  public readonly dropzoneDir: string;
  public readonly runsDir: string;
  public readonly wikiIndexPath: string;
  public readonly wikiLogPath: string;
  private db: DatabaseSync;

  constructor(dataDir: string = getDefaultDataDir()) {
    this.dataDir = path.resolve(dataDir);
    this.artifactsDir = path.join(this.dataDir, 'artifacts');
    this.dropzoneDir = path.join(this.dataDir, 'dropzone');
    this.runsDir = path.join(this.dataDir, 'runs');
    this.wikiIndexPath = path.join(this.dataDir, 'index.md');
    this.wikiLogPath = path.join(this.dataDir, 'log.md');

    fs.mkdirSync(this.artifactsDir, { recursive: true });
    fs.mkdirSync(this.dropzoneDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });

    const dbPath = path.join(this.dataDir, 'index.sqlite');
    this.db = initDatabase(dbPath);
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private uniqueSlug(desiredSlug: string): string {
    const base = slugify(desiredSlug);
    let candidate = base;
    let counter = 2;
    const stmt = this.db.prepare('SELECT 1 FROM artifacts WHERE slug = ?');
    while (stmt.get(candidate)) {
      candidate = `${base}-${counter}`;
      counter++;
    }
    return candidate;
  }

  private updateFtsIndex(
    artifactId: string,
    slug: string,
    title: string,
    description: string,
    category: string,
    tags: string[],
    links: string[],
    content: string
  ): void {
    this.db.prepare('DELETE FROM artifacts_fts WHERE artifact_id = ?').run(artifactId);
    const enrichedTags = [category, ...tags, ...links.map((l) => `link:${l}`)].filter(Boolean).join(' ');
    this.db
      .prepare(
        'INSERT INTO artifacts_fts (artifact_id, slug, title, description, tags, content) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(artifactId, slug, title, description, enrichedTags, content);
  }

  private writeMetaJson(slug: string, meta: ArtifactMetadata): void {
    const artifactFolder = path.join(this.artifactsDir, slug);
    const metaPath = path.join(artifactFolder, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    if (meta.icon) {
      fs.writeFileSync(path.join(artifactFolder, 'icon.svg'), meta.icon, 'utf8');
    }
  }

  public buildWikiIndexMarkdown(projectFilter?: string): string {
    const all = this.listArtifacts({
      project: projectFilter,
      limit: 1000,
    });

    // Group by project -> category -> artifacts
    const byProject = new Map<string, Map<string, ArtifactMetadata[]>>();
    const allCategories = new Set<string>();

    for (const item of all) {
      const proj = item.project || inferWikiProject(item);
      const cat = item.category || inferWikiCategory(item);
      allCategories.add(`${proj}/${cat}`);
      if (!byProject.has(proj)) byProject.set(proj, new Map());
      const catMap = byProject.get(proj)!;
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(item);
    }

    const sortedProjects = Array.from(byProject.keys()).sort((a, b) => a.localeCompare(b));
    const lines: string[] = [
      '# MyArtifact LLM Wiki — Master Index (`index.md`)',
      '',
      '> **Agent Governance (Visual-First + Andrej Karpathy `llm-wiki.md` Pattern):**',
      '> 1. **Orient First:** Read this `index.md` (`myartifact index` or `myartifact index --project <project>`) before creating a new artifact or answering look-back questions.',
      '> 2. **Visual-First Default (`react` / `html` > `markdown`):** Build interactive `react` (`.tsx` with Recharts, Three.js, Lucide, Tailwind, inline SVG) or `html` visualizers whenever explaining benchmarks, >5-row metric tables, architectures, state machines, 3D kinematics/scenes, hardware pinouts/layouts, or checklists. Reserve plain `markdown` ONLY for short narrative notes where charts, diagrams, or interactive controls add zero clarity.',
      '> 3. **Group by Project (`--project`) & Category (`--category`):** Always assign the active project slug (e.g., `argos-01`, `reasoning-lab`, `myartifact`, or the current repo name) and place the artifact into a structured category (`overview`, `roadmaps`, `concepts`, `architecture`, `experiments`, `benchmarks`, `comparisons`, `papers`).',
      '> 4. **Write a Crisp Summary & Cross-Links:** Provide a 1-line `--description` with key metrics/conclusions, link related slugs via `--links`, and upgrade living trackers/reports (`v1 -> v2`, including `markdown -> react` visual upgrades) when new results arrive.',
      '',
      `**Total Artifacts:** ${all.length} across **${sortedProjects.length} projects** (${allCategories.size} project categories) · **Last Synced:** ${new Date().toISOString()}`,
      '',
      '## 📦 Projects Overview',
      '',
      '| Project | Artifacts | Categories | Key Artifacts |',
      '| :--- | :---: | :--- | :--- |',
    ];

    for (const proj of sortedProjects) {
      const catMap = byProject.get(proj)!;
      const cats = Array.from(catMap.keys()).sort();
      const projItems = Array.from(catMap.values()).flat();
      const topSlugs = projItems
        .slice(0, 4)
        .map((i) => `[[${i.slug}]]`)
        .join(', ');
      lines.push(
        `| **\`${proj}\`** | ${projItems.length} | ${cats.map((c) => `\`${c}\``).join(', ')} | ${topSlugs}${projItems.length > 4 ? ', …' : ''} |`
      );
    }

    lines.push('', '---', '');

    for (const proj of sortedProjects) {
      const catMap = byProject.get(proj)!;
      const sortedCategories = Array.from(catMap.keys()).sort((a, b) => a.localeCompare(b));
      const projTotal = Array.from(catMap.values()).reduce((acc, arr) => acc + arr.length, 0);

      lines.push(`## 📦 Project: \`${proj}\` (${projTotal} artifacts)`);
      lines.push('');

      for (const cat of sortedCategories) {
        const items = catMap.get(cat)!;
        lines.push(`### 📂 \`${proj}\` / \`${cat}\``);
        lines.push('');
        for (const item of items) {
          const dateShort = item.updatedAt.slice(0, 10);
          const desc = item.description || `${item.title} (${item.type})`;
          const linksStr =
            item.links && item.links.length > 0
              ? ` · **Links:** ${item.links.map((l) => `[[${l}]]`).join(', ')}`
              : '';
          const tagsStr =
            item.tags && item.tags.length > 0
              ? ` · **Tags:** ${item.tags.map((t) => `\`${t}\``).join(', ')}`
              : '';
          lines.push(
            `- **[[${item.slug}]]** — **[${item.title}](/artifacts/${item.slug})** (\`${item.type}\` · \`v${item.currentVersion}\` · \`${item.agent}\` · ${dateShort})`
          );
          lines.push(`  - ${desc}${tagsStr}${linksStr}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  public syncWikiIndexFile(): string {
    const md = this.buildWikiIndexMarkdown();
    fs.writeFileSync(this.wikiIndexPath, md, 'utf8');
    return md;
  }

  public appendWikiLog(
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ROLLBACK' | 'LINT',
    artifact: {
      slug: string;
      title: string;
      project?: string;
      category?: string;
      agent?: string;
      currentVersion?: number;
      links?: string[];
    },
    summary: string
  ): void {
    const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    if (!fs.existsSync(this.wikiLogPath)) {
      const header = [
        '# MyArtifact LLM Wiki — Chronological Operation Log (`log.md`)',
        '',
        '> Append-only audit trail of all artifact creations, version iterations, project/category placements, and cross-link updates.',
        '',
      ].join('\n');
      fs.writeFileSync(this.wikiLogPath, header, 'utf8');
    }
    const proj = artifact.project || 'general';
    const cat = artifact.category || 'uncategorized';
    const ver = artifact.currentVersion ? `v${artifact.currentVersion}` : '';
    const agent = artifact.agent || 'user';
    const linksPart =
      artifact.links && artifact.links.length > 0
        ? ` → links: ${artifact.links.map((l) => `[[${l}]]`).join(', ')}`
        : '';
    const line = `- **[${nowIso}]** \`${action}\` | \`${agent}\` | \`${proj}/${cat}\` → **[[${artifact.slug}]]** (*${artifact.title}* ${ver}) — ${summary}${linksPart}\n`;
    fs.appendFileSync(this.wikiLogPath, line, 'utf8');
  }

  public getWikiIndexMarkdown(projectFilter?: string): string {
    if (projectFilter && projectFilter !== 'all') {
      return this.buildWikiIndexMarkdown(projectFilter);
    }
    if (!fs.existsSync(this.wikiIndexPath)) {
      return this.syncWikiIndexFile();
    }
    return fs.readFileSync(this.wikiIndexPath, 'utf8');
  }

  public getWikiLogMarkdown(): string {
    if (!fs.existsSync(this.wikiLogPath)) {
      return '# MyArtifact LLM Wiki — Chronological Operation Log (`log.md`)\n\n*(No operations logged yet.)*\n';
    }
    return fs.readFileSync(this.wikiLogPath, 'utf8');
  }

  public getWikiTaxonomy(projectFilter?: string): {
    projects: Array<{
      project: string;
      count: number;
      categories: Array<{ category: string; count: number; slugs: string[] }>;
    }>;
    categories: Array<{ category: string; count: number; slugs: string[] }>;
    backlinks: Record<string, string[]>;
    indexFilePath: string;
    logFilePath: string;
  } {
    const all = this.listArtifacts({
      project: projectFilter,
      limit: 1000,
    });
    const projMap = new Map<string, Map<string, string[]>>();
    const catMap = new Map<string, string[]>();
    const backlinks: Record<string, string[]> = {};

    for (const item of all) {
      const proj = item.project || inferWikiProject(item);
      const cat = item.category || inferWikiCategory(item);
      if (!projMap.has(proj)) projMap.set(proj, new Map());
      const pCats = projMap.get(proj)!;
      if (!pCats.has(cat)) pCats.set(cat, []);
      pCats.get(cat)!.push(item.slug);

      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(item.slug);

      for (const target of item.links || []) {
        if (!backlinks[target]) backlinks[target] = [];
        if (!backlinks[target].includes(item.slug)) {
          backlinks[target].push(item.slug);
        }
      }
    }

    const projects = Array.from(projMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([project, pCats]) => {
        const categories = Array.from(pCats.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([category, slugs]) => ({
            category,
            count: slugs.length,
            slugs,
          }));
        const count = categories.reduce((acc, c) => acc + c.count, 0);
        return { project, count, categories };
      });

    const categories = Array.from(catMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, slugs]) => ({
        category,
        count: slugs.length,
        slugs,
      }));

    return {
      projects,
      categories,
      backlinks,
      indexFilePath: this.wikiIndexPath,
      logFilePath: this.wikiLogPath,
    };
  }

  public createArtifact(input: CreateArtifactInput): ArtifactDetail {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const inferred = inferTypeFromPathOrContent(undefined, input.content);
    const type: ArtifactType = input.type || inferred.type;
    const language = input.language || inferred.language;
    const slug = this.uniqueSlug(input.slug || input.title);
    const agent = input.agent || 'user';
    const tags = input.tags || [];
    const project = inferWikiProject({
      slug,
      title: input.title,
      project: input.project,
      tags,
    });
    const category = inferWikiCategory({
      slug,
      title: input.title,
      type,
      tags,
      category: input.category,
      content: input.content,
    });
    const links = extractWikiLinks(input.content, input.links, slug);
    const description = extractAutoDescription(input.description, input.title, type, input.content);
    const summary = input.summary || 'Initial version (v1)';
    const icon = resolveArtifactIconSvg({
      slug,
      title: input.title,
      type,
      tags,
      icon: input.icon,
      content: input.content,
    });

    const artifactFolder = path.join(this.artifactsDir, slug);
    const versionsFolder = path.join(artifactFolder, 'versions');
    fs.mkdirSync(versionsFolder, { recursive: true });

    const ext = getExtensionForType(type, language);
    const currentFilePath = path.join(artifactFolder, `current${ext}`);
    const v1FilePath = path.join(versionsFolder, `v1${ext}`);

    fs.writeFileSync(currentFilePath, input.content, 'utf8');
    fs.writeFileSync(v1FilePath, input.content, 'utf8');
    fs.writeFileSync(path.join(artifactFolder, 'icon.svg'), icon, 'utf8');

    const contentHash = this.computeHash(input.content);
    const byteSize = Buffer.byteLength(input.content, 'utf8');

    this.db
      .prepare(
        `INSERT INTO artifacts (
          id, slug, title, description, type, language, agent, project, category, tags_json, links_json, icon, current_version, file_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        slug,
        input.title,
        description,
        type,
        language,
        agent,
        project,
        category,
        JSON.stringify(tags),
        JSON.stringify(links),
        icon,
        currentFilePath,
        now,
        now
      );

    this.db
      .prepare(
        `INSERT INTO artifact_versions (
          artifact_id, version, agent, summary, file_path, content_hash, byte_size, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, agent, summary, v1FilePath, contentHash, byteSize, now);

    this.updateFtsIndex(id, slug, input.title, description, category, tags, links, input.content);

    const detail = this.getArtifact(id)!;
    this.writeMetaJson(slug, detail);
    this.syncWikiIndexFile();
    this.appendWikiLog('CREATE', detail, summary);
    return detail;
  }

  public updateArtifact(idOrSlug: string, input: UpdateArtifactInput): ArtifactDetail {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) {
      throw new Error(`Artifact not found: ${idOrSlug}`);
    }

    const now = new Date().toISOString();
    const title = input.title ?? existing.title;
    const inferredUpdate = inferTypeFromPathOrContent(undefined, input.content);
    const type: ArtifactType =
      input.type ??
      (inferredUpdate.type !== 'markdown' ? inferredUpdate.type : existing.type);
    const language =
      input.language ??
      (type !== existing.type
        ? inferredUpdate.type === type
          ? inferredUpdate.language
          : getDefaultLanguageForType(type)
        : existing.language);
    const agent = input.agent ?? existing.agent;
    const tags = input.tags ?? existing.tags;
    const project = inferWikiProject({
      slug: existing.slug,
      title,
      project: input.project ?? existing.project,
      tags,
    });
    const category = inferWikiCategory({
      slug: existing.slug,
      title,
      type,
      tags,
      category: input.category ?? existing.category,
      content: input.content,
    });
    const links = extractWikiLinks(
      input.content,
      input.links ?? existing.links,
      existing.slug
    );
    const description = extractAutoDescription(
      input.description ?? existing.description,
      title,
      type,
      input.content
    );
    const icon = resolveArtifactIconSvg({
      slug: existing.slug,
      title,
      type,
      tags,
      icon: input.icon ?? existing.icon,
      content: input.content,
    });

    const newHash = this.computeHash(input.content);
    const latestVersionObj = existing.versions[existing.versions.length - 1];
    const contentChanged = !latestVersionObj || latestVersionObj.contentHash !== newHash;

    let nextVersion = existing.currentVersion;
    const artifactFolder = path.join(this.artifactsDir, existing.slug);
    const versionsFolder = path.join(artifactFolder, 'versions');
    fs.mkdirSync(versionsFolder, { recursive: true });

    const ext = getExtensionForType(type, language);
    const currentFilePath = path.join(artifactFolder, `current${ext}`);

    if (contentChanged) {
      nextVersion = existing.currentVersion + 1;
      const versionFilePath = path.join(versionsFolder, `v${nextVersion}${ext}`);
      fs.writeFileSync(versionFilePath, input.content, 'utf8');
      fs.writeFileSync(currentFilePath, input.content, 'utf8');
      if (
        existing.filePath &&
        path.resolve(existing.filePath) !== path.resolve(currentFilePath) &&
        path.basename(existing.filePath).startsWith('current.') &&
        fs.existsSync(existing.filePath)
      ) {
        try {
          fs.unlinkSync(existing.filePath);
        } catch {
          // Ignore cleanup errors
        }
      }

      const byteSize = Buffer.byteLength(input.content, 'utf8');
      const summary = input.summary || `Updated to v${nextVersion}`;

      this.db
        .prepare(
          `INSERT INTO artifact_versions (
            artifact_id, version, agent, summary, file_path, content_hash, byte_size, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(existing.id, nextVersion, agent, summary, versionFilePath, newHash, byteSize, now);
    }

    this.db
      .prepare(
        `UPDATE artifacts
         SET title = ?, description = ?, type = ?, language = ?, agent = ?, project = ?, category = ?, tags_json = ?, links_json = ?, icon = ?, current_version = ?, file_path = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        title,
        description,
        type,
        language,
        agent,
        project,
        category,
        JSON.stringify(tags),
        JSON.stringify(links),
        icon,
        nextVersion,
        currentFilePath,
        now,
        existing.id
      );

    this.updateFtsIndex(
      existing.id,
      existing.slug,
      title,
      description,
      category,
      tags,
      links,
      input.content
    );

    const updated = this.getArtifact(existing.id)!;
    this.writeMetaJson(existing.slug, updated);
    this.syncWikiIndexFile();
    this.appendWikiLog('UPDATE', updated, input.summary || (contentChanged ? `Updated to v${nextVersion}` : 'Updated metadata'));
    return updated;
  }

  public upsertBySlug(slug: string, input: CreateArtifactInput): ArtifactDetail {
    const existing = this.getArtifact(slug);
    if (existing) {
      return this.updateArtifact(existing.id, {
        title: input.title || existing.title,
        description: input.description,
        type: input.type,
        language: input.language,
        content: input.content,
        agent: input.agent,
        project: input.project,
        category: input.category,
        tags: input.tags,
        links: input.links,
        icon: input.icon,
        summary: input.summary,
      });
    }
    return this.createArtifact({ ...input, slug });
  }

  public rollbackArtifact(idOrSlug: string, targetVersion: number, agent = 'user'): ArtifactDetail {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) {
      throw new Error(`Artifact not found: ${idOrSlug}`);
    }
    const historicalContent = this.getVersionContent(existing.id, targetVersion);
    if (historicalContent === null) {
      throw new Error(`Version ${targetVersion} not found for artifact ${idOrSlug}`);
    }
    const targetVerMeta = existing.versions.find((v) => v.version === targetVersion);
    const restoredType = inferTypeFromPathOrContent(targetVerMeta?.filePath, historicalContent);
    return this.updateArtifact(existing.id, {
      content: historicalContent,
      type: restoredType.type,
      language: restoredType.language,
      agent,
      summary: `Rolled back to v${targetVersion}`,
    });
  }

  public getArtifact(idOrSlug: string): ArtifactDetail | null {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ? OR slug = ?')
      .get(idOrSlug, idOrSlug) as Record<string, unknown> | undefined;

    if (!row) return null;

    const meta = this.mapRowToMetadata(row);
    let content = '';
    if (fs.existsSync(meta.filePath)) {
      content = fs.readFileSync(meta.filePath, 'utf8');
    }

    const versionRows = this.db
      .prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version ASC')
      .all(meta.id) as Record<string, unknown>[];

    const versions: ArtifactVersion[] = versionRows.map((v) => ({
      artifactId: String(v.artifact_id),
      version: Number(v.version),
      agent: String(v.agent),
      summary: String(v.summary),
      filePath: this.resolveStoredFilePath(String(v.file_path)),
      contentHash: String(v.content_hash),
      byteSize: Number(v.byte_size),
      createdAt: String(v.created_at),
    }));

    return {
      ...meta,
      content,
      versions,
    };
  }

  public getVersionContent(idOrSlug: string, version: number): string | null {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) return null;

    const versionRow = this.db
      .prepare('SELECT file_path FROM artifact_versions WHERE artifact_id = ? AND version = ?')
      .get(existing.id, version) as { file_path: string } | undefined;

    if (!versionRow) return null;
    const resolvedPath = this.resolveStoredFilePath(versionRow.file_path);
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }
    return fs.readFileSync(resolvedPath, 'utf8');
  }

  public listArtifacts(filter: ListArtifactsFilter = {}): ArtifactMetadata[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.query && filter.query.trim()) {
      const sanitized = filter.query
        .trim()
        .replace(/["'*^()-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((tok) => `"${tok}"*`)
        .join(' AND ');

      if (sanitized) {
        conditions.push(
          'id IN (SELECT artifact_id FROM artifacts_fts WHERE artifacts_fts MATCH ?)'
        );
        params.push(sanitized);
      }
    }

    if (filter.agent && filter.agent !== 'all') {
      conditions.push('agent = ?');
      params.push(filter.agent);
    }

    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 200;

    const rows = this.db
      .prepare(`SELECT * FROM artifacts ${whereClause} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];

    let results = rows.map((r) => this.mapRowToMetadata(r));
    if (filter.project && filter.project !== 'all') {
      const normProj = normalizeProjectName(filter.project) || filter.project.trim().toLowerCase();
      results = results.filter(
        (a) => a.project.toLowerCase() === normProj
      );
    }
    if (filter.category && filter.category !== 'all') {
      const normCat = normalizeWikiCategory(filter.category);
      results = results.filter(
        (a) => a.category === normCat || a.category.startsWith(`${normCat}/`)
      );
    }
    if (filter.tag) {
      results = results.filter((a) => a.tags.includes(filter.tag!));
    }
    return results;
  }

  public deleteArtifact(idOrSlug: string): boolean {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) return false;

    this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(existing.id);
    this.db.prepare('DELETE FROM artifacts_fts WHERE artifact_id = ?').run(existing.id);

    const artifactFolder = path.join(this.artifactsDir, existing.slug);
    if (fs.existsSync(artifactFolder)) {
      fs.rmSync(artifactFolder, { recursive: true, force: true });
    }
    const runFolder = path.join(this.runsDir, existing.slug);
    if (fs.existsSync(runFolder)) {
      fs.rmSync(runFolder, { recursive: true, force: true });
    }
    this.syncWikiIndexFile();
    this.appendWikiLog('DELETE', existing, 'Deleted artifact');
    return true;
  }

  // ============================================================================
  // Persistent State API (window.storage)
  // ============================================================================

  private syncStateFile(artifactId: string, slug: string): void {
    const entries = this.getAllStorageEntries(artifactId);
    const stateObj: Record<string, string> = {};
    for (const entry of entries) {
      stateObj[entry.key] = entry.value;
    }
    const statePath = path.join(this.artifactsDir, slug, 'state.json');
    if (fs.existsSync(path.dirname(statePath))) {
      fs.writeFileSync(statePath, JSON.stringify(stateObj, null, 2), 'utf8');
    }
  }

  public getStorageValue(idOrSlug: string, key: string): { key: string; value: string } | null {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) throw new Error(`Artifact not found: ${idOrSlug}`);

    const row = this.db
      .prepare('SELECT key, value FROM artifact_kv_store WHERE artifact_id = ? AND key = ?')
      .get(existing.id, key) as { key: string; value: string } | undefined;

    return row ? { key: row.key, value: row.value } : null;
  }

  public setStorageValue(
    idOrSlug: string,
    key: string,
    value: string
  ): { key: string; value: string } {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) throw new Error(`Artifact not found: ${idOrSlug}`);

    const strVal = String(value);
    const newByteSize = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(strVal, 'utf8');

    const totalRow = this.db
      .prepare(
        'SELECT COALESCE(SUM(byte_size), 0) as total FROM artifact_kv_store WHERE artifact_id = ? AND key != ?'
      )
      .get(existing.id, key) as { total: number };

    if (totalRow.total + newByteSize > MAX_STORAGE_BYTES) {
      throw new Error(`Artifact storage limit exceeded (max 20 MB per artifact)`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO artifact_kv_store (artifact_id, key, value, byte_size, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(artifact_id, key) DO UPDATE SET
           value = excluded.value,
           byte_size = excluded.byte_size,
           updated_at = excluded.updated_at`
      )
      .run(existing.id, key, strVal, newByteSize, now);

    this.syncStateFile(existing.id, existing.slug);
    return { key, value: strVal };
  }

  public deleteStorageValue(idOrSlug: string, key: string): { key: string; deleted: boolean } {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) throw new Error(`Artifact not found: ${idOrSlug}`);

    const info = this.db
      .prepare('DELETE FROM artifact_kv_store WHERE artifact_id = ? AND key = ?')
      .run(existing.id, key);

    this.syncStateFile(existing.id, existing.slug);
    return { key, deleted: Number(info.changes) > 0 };
  }

  public listStorageKeys(idOrSlug: string, prefix = ''): { keys: string[]; prefix: string } {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) throw new Error(`Artifact not found: ${idOrSlug}`);

    const rows = this.db
      .prepare(
        'SELECT key FROM artifact_kv_store WHERE artifact_id = ? AND key LIKE ? ORDER BY key ASC'
      )
      .all(existing.id, `${prefix}%`) as { key: string }[];

    return {
      keys: rows.map((r) => r.key),
      prefix,
    };
  }

  public getAllStorageEntries(idOrSlug: string): StorageEntry[] {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) return [];

    const rows = this.db
      .prepare(
        'SELECT key, value, updated_at FROM artifact_kv_store WHERE artifact_id = ? ORDER BY key ASC'
      )
      .all(existing.id) as { key: string; value: string; updated_at: string }[];

    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      updatedAt: r.updated_at,
    }));
  }

  public clearStorage(idOrSlug: string): void {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) return;

    this.db.prepare('DELETE FROM artifact_kv_store WHERE artifact_id = ?').run(existing.id);
    this.syncStateFile(existing.id, existing.slug);
  }

  // ============================================================================
  // TensorBoard Runs, Scalars (.tfevents) & Saved Model Checkpoints
  // ============================================================================

  private ensureRunArtifact(input: {
    slug: string;
    title?: string;
    experiment?: string;
    modelName?: string;
    framework?: string;
    status?: 'running' | 'completed' | 'failed';
    hparams?: Record<string, string | number | boolean>;
    agent?: string;
    project?: string;
  }): { artifact: ArtifactDetail; manifest: TensorBoardRunManifest } {
    const cleanSlug = slugify(input.slug);
    const existing = this.getArtifact(cleanSlug);
    const runLogDir = path.join(this.runsDir, cleanSlug);
    fs.mkdirSync(path.join(runLogDir, 'checkpoints'), { recursive: true });

    let baseManifest: TensorBoardRunManifest = {
      runSlug: cleanSlug,
      title:
        input.title ||
        cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      experiment: input.experiment || 'default-experiment',
      modelName: input.modelName || cleanSlug,
      framework: input.framework || 'pytorch',
      status: input.status || 'running',
      hparams: input.hparams || {},
      scalars: {},
      checkpoints: [],
      logDir: runLogDir,
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      try {
        const parsed = JSON.parse(existing.content) as Partial<TensorBoardRunManifest>;
        baseManifest = {
          ...baseManifest,
          ...parsed,
          title: input.title || parsed.title || existing.title,
          experiment: input.experiment || parsed.experiment || baseManifest.experiment,
          modelName: input.modelName || parsed.modelName || baseManifest.modelName,
          framework: input.framework || parsed.framework || baseManifest.framework,
          status: input.status || parsed.status || baseManifest.status,
          hparams: { ...(parsed.hparams || {}), ...(input.hparams || {}) },
          logDir: runLogDir,
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Fallback to default manifest
      }
      return { artifact: existing, manifest: baseManifest };
    }

    const created = this.createArtifact({
      slug: cleanSlug,
      title: baseManifest.title,
      description: `TensorBoard training run (${baseManifest.framework}) · ${baseManifest.modelName}`,
      type: 'tensorboard',
      language: 'tensorboard',
      agent: input.agent || 'user',
      project: input.project || baseManifest.experiment,
      tags: ['tensorboard', 'training', baseManifest.framework],
      summary: 'Initialized TensorBoard training run (v1)',
      content: JSON.stringify(baseManifest, null, 2),
    });

    return { artifact: created, manifest: baseManifest };
  }

  private getOrInitEventFilePath(runSlug: string): string {
    const runDir = path.join(this.runsDir, runSlug);
    fs.mkdirSync(runDir, { recursive: true });
    const files = fs
      .readdirSync(runDir)
      .filter((f) => f.includes('.tfevents.'))
      .sort();
    if (files.length > 0) {
      return path.join(runDir, files[files.length - 1]);
    }
    const newPath = path.join(runDir, getDefaultEventFileName());
    fs.writeFileSync(newPath, encodeTfEventHeader());
    return newPath;
  }

  private buildSyncedRunManifest(
    artifactId: string,
    base: TensorBoardRunManifest
  ): TensorBoardRunManifest {
    const scalarRows = this.db
      .prepare(
        'SELECT tag, step, epoch, value, wall_time FROM tb_scalars WHERE artifact_id = ? ORDER BY tag ASC, step ASC'
      )
      .all(artifactId) as Array<{
      tag: string;
      step: number;
      epoch: number | null;
      value: number;
      wall_time: number;
    }>;

    const scalars: Record<string, TensorBoardScalarPoint[]> = {};
    for (const r of scalarRows) {
      if (!scalars[r.tag]) scalars[r.tag] = [];
      scalars[r.tag].push({
        tag: r.tag,
        step: Number(r.step),
        ...(r.epoch !== null && r.epoch !== undefined ? { epoch: Number(r.epoch) } : {}),
        value: Number(r.value),
        wallTime: Number(r.wall_time),
      });
    }

    const checkpoints = this.getModelCheckpoints(artifactId);

    return {
      ...base,
      scalars,
      checkpoints,
      updatedAt: new Date().toISOString(),
    };
  }

  public logTensorBoardScalars(input: LogScalarsInput): ArtifactDetail {
    const { artifact, manifest } = this.ensureRunArtifact(input);
    const nowSec = input.wallTime ?? Date.now() / 1000;
    const points: TensorBoardScalarPoint[] = [...(input.scalars || [])];

    if (input.metrics) {
      const step = input.step ?? 0;
      for (const [tag, value] of Object.entries(input.metrics)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          points.push({
            tag,
            step,
            epoch: input.epoch,
            value,
            wallTime: nowSec,
          });
        }
      }
    }

    const insertStmt = this.db.prepare(
      `INSERT INTO tb_scalars (artifact_id, tag, step, epoch, value, wall_time)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(artifact_id, tag, step) DO UPDATE SET
         epoch = COALESCE(excluded.epoch, tb_scalars.epoch),
         value = excluded.value,
         wall_time = excluded.wall_time`
    );

    const eventFilePath = this.getOrInitEventFilePath(manifest.runSlug);
    const binaryChunks: Buffer[] = [];

    for (const pt of points) {
      insertStmt.run(
        artifact.id,
        pt.tag,
        pt.step,
        pt.epoch ?? null,
        pt.value,
        pt.wallTime || nowSec
      );
      binaryChunks.push(
        encodeTfEventScalar(pt.tag, pt.step, pt.value, pt.wallTime || nowSec)
      );
    }

    if (binaryChunks.length > 0) {
      fs.appendFileSync(eventFilePath, Buffer.concat(binaryChunks));
    }

    const fullManifest = this.buildSyncedRunManifest(artifact.id, {
      ...manifest,
      eventFilePath,
    });
    const serialized = JSON.stringify(fullManifest, null, 2);

    // If an explicit summary was provided, create a new version checkpoint;
    // otherwise update the current file and latest version snapshot in-place so streaming steps don't spam versions.
    if (input.summary) {
      return this.updateArtifact(artifact.id, {
        title: fullManifest.title,
        content: serialized,
        agent: input.agent,
        summary: input.summary,
      });
    }

    fs.writeFileSync(artifact.filePath, serialized, 'utf8');
    const latestVer = artifact.versions[artifact.versions.length - 1];
    if (latestVer && fs.existsSync(latestVer.filePath)) {
      fs.writeFileSync(latestVer.filePath, serialized, 'utf8');
      const hash = this.computeHash(serialized);
      const byteSize = Buffer.byteLength(serialized, 'utf8');
      this.db
        .prepare(
          'UPDATE artifact_versions SET content_hash = ?, byte_size = ? WHERE artifact_id = ? AND version = ?'
        )
        .run(hash, byteSize, artifact.id, latestVer.version);
    }

    const nowIso = new Date().toISOString();
    this.db
      .prepare('UPDATE artifacts SET title = ?, updated_at = ? WHERE id = ?')
      .run(fullManifest.title, nowIso, artifact.id);
    this.updateFtsIndex(
      artifact.id,
      artifact.slug,
      fullManifest.title,
      artifact.description,
      artifact.category,
      artifact.tags,
      artifact.links,
      serialized
    );

    const updated = this.getArtifact(artifact.id)!;
    this.writeMetaJson(updated.slug, updated);
    this.syncWikiIndexFile();
    return updated;
  }

  public saveModelCheckpoint(input: SaveModelCheckpointInput): {
    artifact: ArtifactDetail;
    checkpoint: ModelCheckpoint;
  } {
    const { artifact, manifest } = this.ensureRunArtifact({
      slug: input.slug,
      title: input.title,
      agent: input.agent,
    });

    const step = input.step ?? 0;
    const extFromSource = input.sourceFilePath
      ? path.extname(input.sourceFilePath).replace(/^\./, '')
      : '';
    const format = (input.format || extFromSource || 'safetensors').toLowerCase();
    const rawName =
      input.name ||
      (input.sourceFilePath
        ? path.basename(input.sourceFilePath)
        : `checkpoint-step-${step}.${format}`);
    const safeFileName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');

    const checkpointsDir = path.join(this.runsDir, manifest.runSlug, 'checkpoints');
    fs.mkdirSync(checkpointsDir, { recursive: true });
    const destPath = path.join(checkpointsDir, safeFileName);

    if (input.sourceFilePath && fs.existsSync(input.sourceFilePath)) {
      if (path.resolve(input.sourceFilePath) !== path.resolve(destPath)) {
        fs.copyFileSync(input.sourceFilePath, destPath);
      }
    } else if (input.content !== undefined) {
      const buf = Buffer.isBuffer(input.content)
        ? input.content
        : Buffer.from(String(input.content), 'utf8');
      fs.writeFileSync(destPath, buf);
    } else if (!fs.existsSync(destPath)) {
      // Write a JSON model card / checkpoint metadata header if weights are external
      fs.writeFileSync(
        destPath,
        JSON.stringify(
          {
            runSlug: manifest.runSlug,
            name: safeFileName,
            step,
            epoch: input.epoch,
            metrics: input.metrics || {},
            metadata: input.metadata || {},
            savedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    }

    const fileBuf = fs.readFileSync(destPath);
    const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
    const byteSize = fileBuf.byteLength;
    const isBest = Boolean(input.isBest);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isBest) {
      this.db
        .prepare('UPDATE tb_checkpoints SET is_best = 0 WHERE artifact_id = ?')
        .run(artifact.id);
    }

    this.db
      .prepare(
        `INSERT INTO tb_checkpoints (
          id, artifact_id, run_slug, name, step, epoch, file_path, format, byte_size, sha256, metrics_json, metadata_json, is_best, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        artifact.id,
        manifest.runSlug,
        safeFileName,
        step,
        input.epoch ?? null,
        destPath,
        format,
        byteSize,
        sha256,
        JSON.stringify(input.metrics || {}),
        JSON.stringify(input.metadata || {}),
        isBest ? 1 : 0,
        now
      );

    const eventFilePath = this.getOrInitEventFilePath(manifest.runSlug);
    const fullManifest = this.buildSyncedRunManifest(artifact.id, {
      ...manifest,
      eventFilePath,
    });

    const summary =
      input.summary ||
      `Saved ${isBest ? 'best ' : ''}model checkpoint ${safeFileName} (step ${step})`;

    const updatedArtifact = this.updateArtifact(artifact.id, {
      content: JSON.stringify(fullManifest, null, 2),
      agent: input.agent || 'user',
      summary,
    });

    const checkpoint: ModelCheckpoint = {
      id,
      runSlug: manifest.runSlug,
      name: safeFileName,
      step,
      ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
      filePath: destPath,
      format,
      byteSize,
      sha256,
      metrics: input.metrics || {},
      metadata: input.metadata || {},
      isBest,
      createdAt: now,
    };

    return { artifact: updatedArtifact, checkpoint };
  }

  public importTfEventsFile(
    filePath: string,
    options: { slug?: string; title?: string; agent?: string; project?: string } = {}
  ): ArtifactDetail {
    const resolved = path.resolve(filePath);
    const buf = fs.readFileSync(resolved);
    const scalars = parseTfEventsBuffer(buf);
    const parentFolder = path.basename(path.dirname(resolved));
    const derivedSlug =
      options.slug ||
      (parentFolder && parentFolder !== 'dropzone' && parentFolder !== 'runs'
        ? slugify(parentFolder)
        : slugify(path.basename(resolved).replace(/\.tfevents.*$/, '') || 'tb-run'));

    return this.logTensorBoardScalars({
      slug: derivedSlug,
      title: options.title,
      agent: options.agent || 'watcher',
      project: options.project || 'training',
      scalars,
      summary: `Imported ${scalars.length} scalar events from ${path.basename(resolved)}`,
    });
  }

  public getModelCheckpoints(idOrSlug: string): ModelCheckpoint[] {
    const existing = this.getArtifact(idOrSlug);
    if (!existing) return [];

    const rows = this.db
      .prepare(
        'SELECT * FROM tb_checkpoints WHERE artifact_id = ? ORDER BY step DESC, created_at DESC'
      )
      .all(existing.id) as Record<string, unknown>[];

    return rows.map((r) => this.mapRowToCheckpoint(r));
  }

  public getModelCheckpointById(checkpointId: string): ModelCheckpoint | null {
    const row = this.db
      .prepare('SELECT * FROM tb_checkpoints WHERE id = ?')
      .get(checkpointId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToCheckpoint(row);
  }

  private mapRowToCheckpoint(row: Record<string, unknown>): ModelCheckpoint {
    let metrics: Record<string, number> = {};
    let metadata: Record<string, unknown> = {};
    try {
      metrics = JSON.parse(String(row.metrics_json || '{}'));
    } catch {
      metrics = {};
    }
    try {
      metadata = JSON.parse(String(row.metadata_json || '{}'));
    } catch {
      metadata = {};
    }
    return {
      id: String(row.id),
      runSlug: String(row.run_slug),
      name: String(row.name),
      step: Number(row.step || 0),
      ...(row.epoch !== null && row.epoch !== undefined
        ? { epoch: Number(row.epoch) }
        : {}),
      filePath: this.resolveStoredFilePath(String(row.file_path)),
      format: String(row.format || 'pt'),
      byteSize: Number(row.byte_size || 0),
      sha256: String(row.sha256 || ''),
      metrics,
      metadata,
      isBest: Number(row.is_best) === 1,
      createdAt: String(row.created_at),
    };
  }

  private mapRowToMetadata(row: Record<string, unknown>): ArtifactMetadata {
    let tags: string[] = [];
    let links: string[] = [];
    try {
      tags = JSON.parse(String(row.tags_json || '[]'));
    } catch {
      tags = [];
    }
    try {
      links = JSON.parse(String(row.links_json || '[]'));
    } catch {
      links = [];
    }
    const slug = String(row.slug);
    const title = String(row.title);
    const type = String(row.type) as ArtifactType;
    const rawProject = String(row.project || '');
    const project = inferWikiProject({
      slug,
      title,
      project: rawProject,
      tags,
    });
    const rawCategory = String(row.category || '');
    const category = inferWikiCategory({
      slug,
      title,
      type,
      tags,
      category: rawCategory,
    });
    const rawIcon = String(row.icon || '');
    const icon = resolveArtifactIconSvg({
      slug,
      title,
      type,
      tags,
      icon: rawIcon,
    });
    return {
      id: String(row.id),
      slug,
      title,
      description: String(row.description || ''),
      type,
      language: String(row.language || ''),
      agent: String(row.agent || 'user'),
      project,
      category,
      tags,
      links,
      icon,
      currentVersion: Number(row.current_version || 1),
      filePath: this.resolveStoredFilePath(String(row.file_path)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private resolveStoredFilePath(storedPath: string): string {
    if (!storedPath || fs.existsSync(storedPath)) return storedPath;
    const normalized = storedPath.replace(/\\/g, '/');
    for (const [marker, baseDir] of [
      ['/artifacts/', this.artifactsDir],
      ['/runs/', this.runsDir],
    ] as const) {
      const idx = normalized.lastIndexOf(marker);
      if (idx >= 0) {
        const rel = normalized.slice(idx + marker.length);
        const candidate = path.join(baseDir, ...rel.split('/'));
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return storedPath;
  }

  public close(): void {
    this.db.close();
  }
}
