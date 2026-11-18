export type ArtifactType =
  | 'react'
  | 'html'
  | 'markdown'
  | 'mermaid'
  | 'svg'
  | 'tensorboard'
  | 'code';

export type AgentSource = 'claude-code' | 'codex' | 'antigravity' | 'watcher' | 'user' | string;

export type Role = 'viewer' | 'editor' | 'admin' | 'owner';

export const ROLE_RANK: Record<Role, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

export function rankToRole(rank: number): Role | null {
  if (rank >= 40) return 'owner';
  if (rank >= 30) return 'admin';
  if (rank >= 20) return 'editor';
  if (rank >= 10) return 'viewer';
  return null;
}

export type AgentScope =
  | 'artifacts:read'
  | 'artifacts:write'
  | 'storage:write'
  | 'tb:write'
  | 'artifacts:delete'
  | 'iam:share'
  | 'workspace:admin';

export const DEFAULT_AGENT_SCOPE_CEILING: readonly AgentScope[] = [
  'artifacts:read',
  'artifacts:write',
  'storage:write',
  'tb:write',
] as const;

export const ELEVATED_CLI_SCOPES: readonly AgentScope[] = [
  'artifacts:read',
  'artifacts:write',
  'storage:write',
  'tb:write',
  'artifacts:delete',
  'iam:share',
  'workspace:admin',
] as const;

export type PrincipalType = 'user' | 'pending_email' | 'group' | 'domain';
export type ResourceType = 'workspace' | 'project' | 'category' | 'artifact';
export type AuthSessionKind = 'web' | 'cli_delegated' | 'cli_elevated';

export interface UserProfile {
  id: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  googleHd?: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  isPersonal: boolean;
  allowedGoogleHd?: string;
  createdBy: string;
  effectiveRole?: Role;
  createdAt: string;
}

export interface WorkspaceProject {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  inheritWorkspaceAcl: boolean;
  createdBy: string;
  createdAt: string;
}

export interface WorkspaceGroup {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description?: string;
  memberEmails: string[];
  memberCount: number;
  createdAt: string;
}

export interface RoleBinding {
  id: string;
  workspaceId: string;
  principalType: PrincipalType;
  principalKey: string;
  principalLabel?: string;
  resourceType: ResourceType;
  resourceKey: string;
  role: Role;
  roleRank: number;
  grantedBy: string;
  expiresAt?: string;
  createdAt: string;
}

export type BatchShareResourceSpec =
  | { type: 'workspace'; id: string }
  | { type: 'project'; id: string }
  | { type: 'category'; projectId: string; prefix: string }
  | { type: 'artifact'; id: string }
  | { type: 'filter'; project?: string; tag?: string; query?: string };

export type BatchSharePrincipalSpec =
  | { type: 'email'; email: string }
  | { type: 'group'; groupId: string }
  | { type: 'domain'; domain: string };

export interface BatchShareRequest {
  resources: BatchShareResourceSpec[];
  principals: BatchSharePrincipalSpec[];
  role: 'viewer' | 'editor' | 'admin';
  mode?: 'upgrade_only' | 'set_exact';
  expiresAt?: string;
  notify?: boolean;
}

export interface BatchShareResult {
  applied: number;
  upgraded: number;
  unchanged: number;
  pendingEmailInvites: string[];
  resolvedUserIds: string[];
  targetResourceCount: number;
  bindings: RoleBinding[];
}

export interface BatchRevokeRequest {
  resources: BatchShareResourceSpec[];
  principals: BatchSharePrincipalSpec[];
}

export interface ShareLinkTargetSpec {
  kind: 'project' | 'category' | 'artifact' | 'collection';
  projectSlug?: string;
  categoryPrefix?: string;
  artifactIds?: string[];
}

export interface ShareLink {
  id: string;
  workspaceId: string;
  tokenPrefix: string;
  accessMode: 'anyone' | 'domain';
  requiredHd?: string;
  role: 'viewer' | 'editor';
  targetSpec: ShareLinkTargetSpec;
  label?: string;
  createdBy: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface EffectiveAclDetail {
  resourceType: ResourceType;
  resourceKey: string;
  directBindings: RoleBinding[];
  inheritedBindings: Array<
    RoleBinding & {
      inheritedFrom: ResourceType;
      inheritedFromKey: string;
    }
  >;
  inheritWorkspaceAcl?: boolean;
}

export interface AuthSessionInfo {
  id: string;
  userId: string;
  sessionKind: AuthSessionKind;
  scopeCeiling: AgentScope[];
  defaultWorkspaceId?: string;
  deviceLabel?: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface AuthPrincipalContext {
  authenticated: boolean;
  user?: UserProfile;
  sessionId?: string;
  sessionKind?: AuthSessionKind;
  scopes: AgentScope[];
  viaAgent: string;
  shareLink?: ShareLink;
  defaultWorkspaceId?: string;
}

export interface AuditEvent {
  id: string;
  workspaceId?: string;
  actorUserId?: string;
  actorEmail?: string;
  viaAgent: string;
  authSessionId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface WikiTaxonomy {
  projects: Array<{
    project: string;
    count: number;
    inheritWorkspaceAcl?: boolean;
    categories: Array<{ category: string; count: number; slugs: string[] }>;
  }>;
  categories: Array<{ category: string; count: number; slugs: string[] }>;
  backlinks: Record<string, string[]>;
  indexFilePath?: string;
  logFilePath?: string;
}

export interface ArtifactMetadata {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: ArtifactType;
  language: string;
  agent: AgentSource;
  project: string;
  category: string;
  tags: string[];
  links: string[];
  icon?: string;
  currentVersion: number;
  filePath: string;
  workspaceId?: string;
  workspaceSlug?: string;
  authorUserId?: string;
  authorEmail?: string;
  effectiveRole?: Role;
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
  blobSha256?: string;
  authorUserId?: string;
  authorEmail?: string;
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
  category?: string;
  tags?: string[];
  links?: string[];
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
  category?: string;
  tags?: string[];
  links?: string[];
  icon?: string;
  summary?: string;
}

export interface ListArtifactsFilter {
  query?: string;
  agent?: string;
  type?: ArtifactType;
  project?: string;
  category?: string;
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
