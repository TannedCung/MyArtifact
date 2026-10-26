export type ArtifactType = 'react' | 'html' | 'markdown' | 'mermaid' | 'svg' | 'code';

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
