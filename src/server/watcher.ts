import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import {
  ArtifactStore,
  inferTypeFromPathOrContent,
  slugify,
} from '../core/storage.js';
import type { ArtifactDetail } from '../core/types.js';

export interface WatcherCallbacks {
  onArtifactUpserted?: (artifact: ArtifactDetail, sourcePath: string) => void;
}

export function extractDirectiveMetadata(content: string): {
  title?: string;
  agent?: string;
  project?: string;
  tags?: string[];
  description?: string;
} {
  const headerLines = content.split(/\r?\n/).slice(0, 15);
  const meta: {
    title?: string;
    agent?: string;
    project?: string;
    tags?: string[];
    description?: string;
  } = {};

  for (const line of headerLines) {
    const match = line.match(
      /^(?:\/\/|#|<!--|\*)\s*@(title|agent|project|tags|description)\s*:\s*(.+?)(?:-->)?$/i
    );
    if (match) {
      const key = match[1].toLowerCase();
      const val = match[2].trim();
      if (key === 'title') meta.title = val;
      if (key === 'agent') meta.agent = val;
      if (key === 'project') meta.project = val;
      if (key === 'description') meta.description = val;
      if (key === 'tags') {
        meta.tags = val
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }
  }
  return meta;
}

export function startArtifactWatcher(
  store: ArtifactStore,
  extraWatchDirs: string[] = [],
  callbacks: WatcherCallbacks = {}
): FSWatcher {
  const watchTargets = [
    store.dropzoneDir,
    store.artifactsDir,
    ...extraWatchDirs.map((d) => path.resolve(d)),
  ];

  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    persistent: true,
    depth: 3,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 40,
    },
  });

  const handleFileEvent = (filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;

      const baseName = path.basename(filePath);
      if (
        baseName.startsWith('.') ||
        baseName === 'meta.json' ||
        baseName === 'state.json' ||
        filePath.includes(`${path.sep}versions${path.sep}`)
      ) {
        return;
      }

      // Case 1: Editing an existing artifact's current.<ext> directly on disk
      if (filePath.startsWith(store.artifactsDir) && baseName.startsWith('current.')) {
        const slug = path.basename(path.dirname(filePath));
        const existing = store.getArtifact(slug);
        if (!existing) return;

        const newContent = fs.readFileSync(filePath, 'utf8');
        if (newContent === existing.content) return;

        const updated = store.updateArtifact(existing.id, {
          content: newContent,
          summary: `Updated on disk (${baseName})`,
        });
        callbacks.onArtifactUpserted?.(updated, filePath);
        return;
      }

      // Case 2: File added or modified in dropzone or extra watched directory
      if (!filePath.startsWith(store.artifactsDir)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const inferred = inferTypeFromPathOrContent(filePath, content);
        const directives = extractDirectiveMetadata(content);
        const ext = path.extname(baseName);
        const rawName = path.basename(baseName, ext);
        const slug = slugify(rawName);
        const existing = store.getArtifact(slug);

        if (existing && existing.content === content) {
          return;
        }

        const humanTitle =
          directives.title ||
          rawName
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());

        const artifact = store.upsertBySlug(slug, {
          title: humanTitle,
          description: directives.description || `Synced from ${baseName}`,
          type: inferred.type,
          language: inferred.language,
          content,
          agent: directives.agent || 'watcher',
          project: directives.project || 'dropzone',
          tags: directives.tags || [inferred.type, 'watched'],
          summary: existing
            ? `Synced update from ${baseName}`
            : `Created from watched file ${baseName}`,
        });

        callbacks.onArtifactUpserted?.(artifact, filePath);
      }
    } catch (err) {
      // Ignore transient read errors during atomic saves
    }
  };

  watcher.on('add', handleFileEvent);
  watcher.on('change', handleFileEvent);

  return watcher;
}
