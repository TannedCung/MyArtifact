import type {
  AgentScope,
  ArtifactDetail,
  ArtifactMetadata,
  ArtifactVersion,
  AuditEvent,
  AuthPrincipalContext,
  AuthSessionInfo,
  AuthSessionKind,
  BatchRevokeRequest,
  BatchShareRequest,
  BatchShareResult,
  CreateArtifactInput,
  EffectiveAclDetail,
  ListArtifactsFilter,
  LogScalarsInput,
  ModelCheckpoint,
  Role,
  RoleBinding,
  SaveModelCheckpointInput,
  ShareLink,
  ShareLinkTargetSpec,
  StorageEntry,
  UpdateArtifactInput,
  UserProfile,
  WikiTaxonomy,
  Workspace,
  WorkspaceGroup,
  WorkspaceProject,
} from '../core/types.js';
import type { BlobStore } from './blob-store.js';

export interface CloudPubSubEvent {
  type: string;
  workspaceId: string;
  artifactId?: string;
  artifact?: ArtifactMetadata;
  payload: Record<string, unknown>;
}

export interface WorkspaceSyncState {
  workspaceId: string;
  revision: string;
  artifactRevision?: string;
  storageRevision?: string;
  serverTime: string;
}

export interface UpsertGoogleUserInput {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  googleHd?: string;
  displayName: string;
  avatarUrl?: string;
}

export interface UpsertGoogleUserResult {
  user: UserProfile;
  personalWorkspace: Workspace;
  claimedInvites: number;
}

export interface CreateSessionInput {
  userId: string;
  sessionKind: AuthSessionKind;
  refreshTokenHash: string;
  scopeCeiling: AgentScope[];
  defaultWorkspaceId?: string;
  deviceLabel?: string;
  expiresAt: string;
}

export interface RotateRefreshInput {
  presentedTokenHash: string;
  nextRefreshTokenHash: string;
  nextExpiresAt: string;
  graceWindowMs?: number;
}

export interface RotateRefreshResult {
  session: AuthSessionInfo;
  user: UserProfile;
  usedGraceWindow: boolean;
}

export interface OAuthStateRecord {
  state: string;
  nonce: string;
  codeVerifier: string;
  flowKind: 'web' | 'cli_loopback';
  redirectUri: string;
  cliChallenge?: string;
  cliRedirectUri?: string;
  cliState?: string;
  elevate: boolean;
  requestedWorkspace?: string;
  expiresAt: string;
}

export interface CliAuthCodeRecord {
  codeHash: string;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  elevate: boolean;
  defaultWorkspaceId?: string;
  deviceLabel: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface DeviceAuthRecord {
  deviceCodeHash: string;
  userCode: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  userId?: string;
  elevate: boolean;
  defaultWorkspaceId?: string;
  deviceLabel: string;
  intervalSec: number;
  expiresAt: string;
  createdAt: string;
}

export interface CloudStore {
  readonly blobStore: BlobStore;
  subscribe(listener: (event: CloudPubSubEvent) => void): () => void;
  publish(event: CloudPubSubEvent): Promise<void>;

  // Identity & Sessions
  upsertGoogleUser(input: UpsertGoogleUserInput): Promise<UpsertGoogleUserResult>;
  getUserById(userId: string): Promise<UserProfile | null>;
  getUserByEmail(email: string): Promise<UserProfile | null>;

  createAuthSession(input: CreateSessionInput): Promise<AuthSessionInfo>;
  getAuthSession(sessionId: string): Promise<AuthSessionInfo | null>;
  listUserSessions(userId: string): Promise<AuthSessionInfo[]>;
  rotateRefreshToken(input: RotateRefreshInput): Promise<RotateRefreshResult>;
  revokeSession(sessionId: string, actorUserId: string): Promise<boolean>;

  // OAuth / PKCE / Device Flow state
  saveOAuthState(record: OAuthStateRecord): Promise<void>;
  consumeOAuthState(state: string): Promise<OAuthStateRecord | null>;
  saveCliAuthCode(record: CliAuthCodeRecord): Promise<void>;
  consumeCliAuthCode(codeHash: string): Promise<CliAuthCodeRecord | null>;
  createDeviceAuthCode(record: DeviceAuthRecord): Promise<void>;
  getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthRecord | null>;
  getDeviceAuthByDeviceCodeHash(deviceCodeHash: string): Promise<DeviceAuthRecord | null>;
  approveDeviceAuthCode(
    userCode: string,
    userId: string,
    defaultWorkspaceId?: string,
    elevate?: boolean
  ): Promise<DeviceAuthRecord | null>;
  consumeDeviceAuthCode(deviceCodeHash: string): Promise<DeviceAuthRecord | null>;

  // Workspaces, Projects & Groups
  listWorkspacesForUser(userId: string, googleHd?: string): Promise<Workspace[]>;
  getWorkspace(idOrSlug: string): Promise<Workspace | null>;
  createWorkspace(
    ctx: AuthPrincipalContext,
    input: { slug?: string; name: string; allowedGoogleHd?: string }
  ): Promise<Workspace>;
  listProjects(ctx: AuthPrincipalContext, workspaceId: string): Promise<WorkspaceProject[]>;
  setProjectVisibility(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectSlug: string,
    inheritWorkspaceAcl: boolean
  ): Promise<WorkspaceProject>;

  listGroups(ctx: AuthPrincipalContext, workspaceId: string): Promise<WorkspaceGroup[]>;
  createGroup(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: { slug?: string; name: string; description?: string; memberEmails?: string[] }
  ): Promise<WorkspaceGroup>;
  updateGroupMembers(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    groupIdOrSlug: string,
    input: { addEmails?: string[]; removeEmails?: string[] }
  ): Promise<WorkspaceGroup>;

  // RBAC, Batch Sharing & Share Links
  resolveWorkspaceRole(ctx: AuthPrincipalContext, workspaceId: string): Promise<Role | null>;
  resolveArtifactRole(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<{ artifact: ArtifactMetadata; role: Role | null } | null>;
  getResourceAcl(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    resourceType: 'workspace' | 'project' | 'category' | 'artifact',
    resourceKey: string
  ): Promise<EffectiveAclDetail>;
  applyBatchGrants(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    request: BatchShareRequest
  ): Promise<BatchShareResult>;
  revokeBatchGrants(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    request: BatchRevokeRequest
  ): Promise<{ revokedCount: number }>;

  createShareLink(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: {
      accessMode: 'anyone' | 'domain';
      requiredHd?: string;
      role: 'viewer' | 'editor';
      targetSpec: ShareLinkTargetSpec;
      label?: string;
      expiresAt?: string;
    }
  ): Promise<{ link: ShareLink; token: string }>;
  listShareLinks(ctx: AuthPrincipalContext, workspaceId: string): Promise<ShareLink[]>;
  revokeShareLink(ctx: AuthPrincipalContext, workspaceId: string, linkId: string): Promise<boolean>;
  resolveShareLinkByToken(token: string): Promise<ShareLink | null>;
  getShareLinkBundle(
    ctx: AuthPrincipalContext,
    token: string
  ): Promise<{
    link: ShareLink;
    workspace: Workspace;
    artifacts: ArtifactMetadata[];
  }>;

  // Workspace-scoped Artifacts, Storage, Wiki & TensorBoard
  createArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: CreateArtifactInput
  ): Promise<ArtifactDetail>;
  updateArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    input: UpdateArtifactInput
  ): Promise<ArtifactDetail>;
  upsertBySlug(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    slug: string,
    input: CreateArtifactInput
  ): Promise<ArtifactDetail>;
  rollbackArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    targetVersion: number
  ): Promise<ArtifactDetail>;
  getArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<ArtifactDetail | null>;
  getVersionContent(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    version: number
  ): Promise<string | null>;
  listArtifacts(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    filter?: ListArtifactsFilter
  ): Promise<ArtifactMetadata[]>;
  deleteArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<boolean>;

  getStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; value: string } | null>;
  setStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string,
    value: string
  ): Promise<{ key: string; value: string }>;
  deleteStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; deleted: boolean }>;
  listStorageKeys(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    prefix?: string
  ): Promise<{ keys: string[]; prefix: string }>;
  getAllStorageEntries(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<StorageEntry[]>;
  clearStorage(ctx: AuthPrincipalContext, workspaceId: string, idOrSlug: string): Promise<void>;

  getWikiData(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectFilter?: string
  ): Promise<WikiTaxonomy & { indexMarkdown: string; logMarkdown: string }>;

  logTensorBoardScalars(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: LogScalarsInput
  ): Promise<ArtifactDetail>;
  saveModelCheckpoint(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: SaveModelCheckpointInput
  ): Promise<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }>;
  presignCheckpointUpload(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    runSlug: string,
    input: { name: string; contentType?: string }
  ): Promise<{
    checkpointId: string;
    objectKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresAt: string;
  }>;
  finalizeCheckpointUpload(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    runSlug: string,
    input: {
      checkpointId: string;
      objectKey: string;
      name: string;
      step?: number;
      epoch?: number;
      format?: string;
      metrics?: Record<string, number>;
      metadata?: Record<string, unknown>;
      isBest?: boolean;
      agent?: string;
      summary?: string;
    }
  ): Promise<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }>;
  getModelCheckpoints(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<ModelCheckpoint[]>;
  getCheckpointDownloadUrl(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    checkpointId: string
  ): Promise<{ checkpoint: ModelCheckpoint; url: string } | null>;
  listAuditEvents(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    limit?: number
  ): Promise<AuditEvent[]>;
  getWorkspaceSyncState(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    selectedArtifactIdOrSlug?: string
  ): Promise<WorkspaceSyncState>;

  close(): Promise<void>;
}
