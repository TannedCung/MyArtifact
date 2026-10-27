export type ArtifactType =
  | 'react'
  | 'html'
  | 'markdown'
  | 'mermaid'
  | 'svg'
  | 'tensorboard'
  | 'code';

export type AgentSource = 'claude-code' | 'codex' | 'antigravity' | 'watcher' | 'user' | string;

export interface ArtifactMetadata {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: ArtifactType;
  language: string;
  agent: AgentSource;
  project: string;
  tags: string[];
  icon?: string;
  currentVersion: number;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  artifactId: string;
  version: number;
  agent: AgentSource;
  summary: string;
  filePath: string;
  contentHash: string;
  byteSize: number;
  createdAt: string;
}

export interface ArtifactDetail extends ArtifactMetadata {
  content: string;
  versions: ArtifactVersion[];
}

export interface CreateArtifactInput {
  slug?: string;
  title: string;
  description?: string;
  type?: ArtifactType;
  language?: string;
  content: string;
  agent?: AgentSource;
  project?: string;
  tags?: string[];
  icon?: string;
  summary?: string;
}

export interface UpdateArtifactInput {
  title?: string;
  description?: string;
  type?: ArtifactType;
  language?: string;
  content: string;
  agent?: AgentSource;
  project?: string;
  tags?: string[];
  icon?: string;
  summary?: string;
}

export interface ListArtifactsFilter {
  query?: string;
  agent?: string;
  type?: ArtifactType;
  project?: string;
  tag?: string;
  limit?: number;
}

export interface StorageEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export interface TensorBoardScalarPoint {
  tag: string;
  step: number;
  epoch?: number;
  value: number;
  wallTime: number;
}

export interface ModelCheckpoint {
  id: string;
  runSlug: string;
  name: string;
  step: number;
  epoch?: number;
  filePath: string;
  format: string;
  byteSize: number;
  sha256: string;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  isBest: boolean;
  createdAt: string;
}

export interface TensorBoardRunManifest {
  runSlug: string;
  title: string;
  experiment: string;
  modelName: string;
  framework: string;
  status: 'running' | 'completed' | 'failed';
  hparams: Record<string, string | number | boolean>;
  scalars: Record<string, TensorBoardScalarPoint[]>;
  checkpoints: ModelCheckpoint[];
  logDir: string;
  eventFilePath?: string;
  updatedAt: string;
}

export interface LogScalarsInput {
  slug: string;
  title?: string;
  experiment?: string;
  modelName?: string;
  framework?: string;
  status?: 'running' | 'completed' | 'failed';
  agent?: AgentSource;
  project?: string;
  hparams?: Record<string, string | number | boolean>;
  step?: number;
  epoch?: number;
  wallTime?: number;
  metrics?: Record<string, number>;
  scalars?: TensorBoardScalarPoint[];
  summary?: string;
}

export interface SaveModelCheckpointInput {
  slug: string;
  title?: string;
  name?: string;
  step?: number;
  epoch?: number;
  sourceFilePath?: string;
  content?: Buffer | string;
  format?: string;
  metrics?: Record<string, number>;
  metadata?: Record<string, unknown>;
  isBest?: boolean;
  agent?: AgentSource;
  summary?: string;
}
