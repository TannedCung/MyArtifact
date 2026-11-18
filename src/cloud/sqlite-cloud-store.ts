import crypto from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';
import { openSqliteDatabase } from '../core/db.js';
import { resolveArtifactIconSvg } from '../core/icons.js';
import {
  extractAutoDescription,
  extractWikiLinks,
  getDefaultLanguageForType,
  inferTypeFromPathOrContent,
  inferWikiCategory,
  inferWikiProject,
  normalizeProjectName,
  normalizeWikiCategory,
  slugify,
} from '../core/storage.js';
import { parseTfEventsBuffer } from '../core/tensorboard.js';
import {
  ROLE_RANK,
  rankToRole,
  type AgentScope,
  type ArtifactDetail,
  type ArtifactMetadata,
  type ArtifactType,
  type ArtifactVersion,
  type AuditEvent,
  type AuthPrincipalContext,
  type AuthSessionInfo,
  type AuthSessionKind,
  type BatchRevokeRequest,
  type BatchShareRequest,
  type BatchShareResult,
  type CreateArtifactInput,
  type EffectiveAclDetail,
  type ListArtifactsFilter,
  type LogScalarsInput,
  type ModelCheckpoint,
  type PrincipalType,
  type ResourceType,
  type Role,
  type RoleBinding,
  type SaveModelCheckpointInput,
  type ShareLink,
  type ShareLinkTargetSpec,
  type StorageEntry,
  type TensorBoardRunManifest,
  type TensorBoardScalarPoint,
  type UpdateArtifactInput,
  type UserProfile,
  type WikiTaxonomy,
  type Workspace,
  type WorkspaceGroup,
  type WorkspaceProject,
} from '../core/types.js';
import { LocalDiskBlobStore, type BlobStore } from './blob-store.js';
import { sha256Hex } from './auth/jwt.js';
import {
  CloudPermissionError,
  assertBatchRequestShape,
  assertValidCheckpointFinalizeInput,
  capSessionExpiresAt,
  clampQueryLimit,
  computeMaxRoleRank,
  escapeSqlLikePrefix,
  evaluateAccess,
  isBindingActive,
  isShareLinkValidForContext,
  matchesCategoryPrefix,
  normalizeCategoryKey,
  parseBatchGrantRole,
  shareLinkCoversArtifact,
} from './rbac.js';
import type {
  CliAuthCodeRecord,
  CloudPubSubEvent,
  CloudStore,
  CreateSessionInput,
  DeviceAuthRecord,
  OAuthStateRecord,
  RotateRefreshInput,
  RotateRefreshResult,
  UpsertGoogleUserInput,
  UpsertGoogleUserResult,
  WorkspaceSyncState,
} from './store-interface.js';

const MAX_STORAGE_BYTES = 20 * 1024 * 1024;

export class SqliteCloudStore implements CloudStore {
  public readonly blobStore: BlobStore;
  private readonly db: DatabaseSync;
  private readonly emitter = new EventEmitter();

  constructor(dataDir: string, blobStore?: BlobStore) {
    const resolvedDir = path.resolve(dataDir);
    this.blobStore = blobStore || new LocalDiskBlobStore(path.join(resolvedDir, 'blobs'));
    this.db = openSqliteDatabase(path.join(resolvedDir, 'cloud.sqlite'));
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        google_sub TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        google_hd TEXT,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        is_personal INTEGER NOT NULL DEFAULT 0,
        allowed_google_hd TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        inherit_workspace_acl INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, slug),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, slug),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        member_email TEXT NOT NULL,
        added_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (group_id, member_email),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_kind TEXT NOT NULL,
        refresh_token_hash TEXT UNIQUE NOT NULL,
        prev_refresh_token_hash TEXT,
        prev_grace_until TEXT,
        scope_ceiling_json TEXT NOT NULL DEFAULT '[]',
        default_workspace_id TEXT,
        device_label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        flow_kind TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        cli_challenge TEXT,
        cli_redirect_uri TEXT,
        cli_state TEXT,
        elevate INTEGER NOT NULL DEFAULT 0,
        requested_workspace TEXT,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cli_auth_codes (
        code_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        elevate INTEGER NOT NULL DEFAULT 0,
        default_workspace_id TEXT,
        device_label TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS device_auth_codes (
        device_code_hash TEXT PRIMARY KEY,
        user_code TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL,
        user_id TEXT,
        elevate INTEGER NOT NULL DEFAULT 0,
        default_workspace_id TEXT,
        device_label TEXT NOT NULL DEFAULT '',
        interval_sec INTEGER NOT NULL DEFAULT 2,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT '',
        agent TEXT NOT NULL DEFAULT 'user',
        project_slug TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        links_json TEXT NOT NULL DEFAULT '[]',
        icon TEXT NOT NULL DEFAULT '',
        current_version INTEGER NOT NULL DEFAULT 1,
        current_blob_sha256 TEXT NOT NULL,
        author_user_id TEXT,
        author_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, slug),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
        artifact_id UNINDEXED,
        workspace_id UNINDEXED,
        slug,
        title,
        description,
        tags,
        content
      );

      CREATE TABLE IF NOT EXISTS artifact_versions (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        agent TEXT NOT NULL DEFAULT 'user',
        summary TEXT NOT NULL DEFAULT '',
        blob_sha256 TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        author_user_id TEXT,
        author_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifact_kv_store (
        artifact_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, key),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tb_scalars (
        artifact_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        step INTEGER NOT NULL,
        epoch REAL,
        value REAL NOT NULL,
        wall_time REAL NOT NULL,
        PRIMARY KEY (artifact_id, tag, step),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tb_checkpoints (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        run_slug TEXT NOT NULL,
        name TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 0,
        epoch REAL,
        object_key TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'pt',
        byte_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL DEFAULT '',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        is_best INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS role_bindings (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_key TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        role_rank INTEGER NOT NULL,
        granted_by TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, principal_type, principal_key, resource_type, resource_key),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS share_links (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        token_prefix TEXT NOT NULL,
        access_mode TEXT NOT NULL,
        required_hd TEXT,
        role_rank INTEGER NOT NULL,
        target_spec_json TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        actor_user_id TEXT,
        actor_email TEXT NOT NULL DEFAULT '',
        via_agent TEXT NOT NULL DEFAULT 'web',
        auth_session_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
  }

  public subscribe(listener: (event: CloudPubSubEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  public async publish(event: CloudPubSubEvent): Promise<void> {
    this.emitter.emit('event', event);
  }

  private mapUser(row: Record<string, unknown>): UserProfile {
    return {
      id: String(row.id),
      googleSub: String(row.google_sub),
      email: String(row.email),
      emailVerified: Number(row.email_verified) === 1,
      ...(row.google_hd ? { googleHd: String(row.google_hd) } : {}),
      displayName: String(row.display_name),
      ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorkspace(row: Record<string, unknown>, effectiveRole?: Role): Workspace {
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      isPersonal: Number(row.is_personal) === 1,
      ...(row.allowed_google_hd ? { allowedGoogleHd: String(row.allowed_google_hd) } : {}),
      createdBy: String(row.created_by),
      ...(effectiveRole ? { effectiveRole } : {}),
      createdAt: String(row.created_at),
    };
  }

  private mapSession(row: Record<string, unknown>): AuthSessionInfo {
    let scopeCeiling: AgentScope[] = [];
    try {
      scopeCeiling = JSON.parse(String(row.scope_ceiling_json || '[]'));
    } catch {
      scopeCeiling = [];
    }
    return {
      id: String(row.id),
      userId: String(row.user_id),
      sessionKind: String(row.session_kind) as AuthSessionKind,
      scopeCeiling,
      ...(row.default_workspace_id
        ? { defaultWorkspaceId: String(row.default_workspace_id) }
        : {}),
      ...(row.device_label ? { deviceLabel: String(row.device_label) } : {}),
      createdAt: String(row.created_at),
      lastUsedAt: String(row.last_used_at),
      expiresAt: String(row.expires_at),
      ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {}),
    };
  }

  private mapBinding(row: Record<string, unknown>): RoleBinding {
    const rank = Number(row.role_rank);
    const principalType = String(row.principal_type) as PrincipalType;
    const principalKey = String(row.principal_key);
    let principalLabel = principalKey;
    if (principalType === 'user') {
      const u = this.db
        .prepare('SELECT email FROM users WHERE id = ?')
        .get(principalKey) as { email?: string } | undefined;
      if (u?.email) principalLabel = u.email;
    } else if (principalType === 'group') {
      const g = this.db
        .prepare('SELECT name, slug FROM groups WHERE id = ?')
        .get(principalKey) as { name?: string; slug?: string } | undefined;
      if (g?.slug) principalLabel = `@${g.slug} (${g.name})`;
    } else if (principalType === 'domain') {
      principalLabel = `*@${principalKey}`;
    }
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      principalType,
      principalKey,
      principalLabel,
      resourceType: String(row.resource_type) as ResourceType,
      resourceKey: String(row.resource_key),
      role: rankToRole(rank) || 'viewer',
      roleRank: rank,
      grantedBy: String(row.granted_by || ''),
      ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
      createdAt: String(row.created_at),
    };
  }

  private mapShareLink(row: Record<string, unknown>): ShareLink {
    let targetSpec: ShareLinkTargetSpec = { kind: 'artifact', artifactIds: [] };
    try {
      targetSpec = JSON.parse(String(row.target_spec_json || '{}'));
    } catch {
      targetSpec = { kind: 'artifact', artifactIds: [] };
    }
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      tokenPrefix: String(row.token_prefix),
      accessMode: String(row.access_mode) as 'anyone' | 'domain',
      ...(row.required_hd ? { requiredHd: String(row.required_hd) } : {}),
      role: Number(row.role_rank) >= 20 ? 'editor' : 'viewer',
      targetSpec,
      ...(row.label ? { label: String(row.label) } : {}),
      createdBy: String(row.created_by),
      ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
      ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {}),
      createdAt: String(row.created_at),
    };
  }

  private recordAudit(input: {
    workspaceId?: string;
    ctx?: AuthPrincipalContext;
    actorUserId?: string;
    actorEmail?: string;
    viaAgent?: string;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
  }): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO audit_events (id, workspace_id, actor_user_id, actor_email, via_agent, auth_session_id, action, resource_type, resource_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.workspaceId || null,
        input.actorUserId || input.ctx?.user?.id || null,
        input.actorEmail || input.ctx?.user?.email || '',
        input.viaAgent || input.ctx?.viaAgent || 'web',
        input.ctx?.sessionId || null,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.details || {}),
        now
      );
  }

  private uniqueWorkspaceSlug(baseRaw: string): string {
    const base = slugify(baseRaw).slice(0, 48) || 'workspace';
    let candidate = base;
    let counter = 2;
    const stmt = this.db.prepare('SELECT 1 FROM workspaces WHERE LOWER(slug) = LOWER(?)');
    while (stmt.get(candidate)) {
      candidate = `${base}-${counter++}`;
    }
    return candidate;
  }

  private uniqueArtifactSlug(workspaceId: string, baseRaw: string): string {
    const base = slugify(baseRaw);
    let candidate = base;
    let counter = 2;
    const stmt = this.db.prepare(
      'SELECT 1 FROM artifacts WHERE workspace_id = ? AND LOWER(slug) = LOWER(?)'
    );
    while (stmt.get(workspaceId, candidate)) {
      candidate = `${base}-${counter++}`;
    }
    return candidate;
  }

  async upsertGoogleUser(input: UpsertGoogleUserInput): Promise<UpsertGoogleUserResult> {
    if (!input.emailVerified) {
      throw new CloudPermissionError(
        'Google account email must be verified before cloud access is granted',
        403,
        'unauthenticated'
      );
    }

    const email = input.email.trim().toLowerCase();
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      let existingRow = this.db
        .prepare('SELECT * FROM users WHERE google_sub = ? OR LOWER(email) = ?')
        .get(input.googleSub, email) as Record<string, unknown> | undefined;

      let userId: string;
      if (existingRow) {
        userId = String(existingRow.id);
        this.db
          .prepare(
            `UPDATE users
             SET google_sub = ?, email = ?, email_verified = 1, google_hd = ?, display_name = ?, avatar_url = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            input.googleSub,
            email,
            input.googleHd ? input.googleHd.trim().toLowerCase() : null,
            input.displayName || email,
            input.avatarUrl || null,
            now,
            userId
          );
      } else {
        userId = crypto.randomUUID();
        this.db
          .prepare(
            `INSERT INTO users (id, google_sub, email, email_verified, google_hd, display_name, avatar_url, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .run(
            userId,
            input.googleSub,
            email,
            input.googleHd ? input.googleHd.trim().toLowerCase() : null,
            input.displayName || email,
            input.avatarUrl || null,
            now,
            now
          );
      }

      const userRow = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as Record<string, unknown>;
      const user = this.mapUser(userRow);

      // Ensure personal workspace exists
      let personalWsRow = this.db
        .prepare('SELECT * FROM workspaces WHERE created_by = ? AND is_personal = 1')
        .get(userId) as Record<string, unknown> | undefined;

      if (!personalWsRow) {
        const wsId = crypto.randomUUID();
        const handle = email.split('@')[0] || 'personal';
        const wsSlug = this.uniqueWorkspaceSlug(handle);
        this.db
          .prepare(
            `INSERT INTO workspaces (id, slug, name, is_personal, allowed_google_hd, created_by, created_at)
             VALUES (?, ?, ?, 1, NULL, ?, ?)`
          )
          .run(wsId, wsSlug, `${input.displayName || handle}'s Workspace`, userId, now);

        this.db
          .prepare(
            `INSERT INTO role_bindings (id, workspace_id, principal_type, principal_key, resource_type, resource_key, role_rank, granted_by, expires_at, created_at)
             VALUES (?, ?, 'user', ?, 'workspace', ?, 40, ?, NULL, ?)`
          )
          .run(crypto.randomUUID(), wsId, userId, wsId, userId, now);

        personalWsRow = this.db
          .prepare('SELECT * FROM workspaces WHERE id = ?')
          .get(wsId) as Record<string, unknown>;
      }

      // Auto-claim pending_email batch invites
      const pendingRows = this.db
        .prepare(
          "SELECT * FROM role_bindings WHERE principal_type = 'pending_email' AND LOWER(principal_key) = ?"
        )
        .all(email) as Record<string, unknown>[];

      let claimedInvites = 0;
      for (const pending of pendingRows) {
        const wsId = String(pending.workspace_id);
        const resType = String(pending.resource_type);
        const resKey = String(pending.resource_key);
        const pendingRank = Number(pending.role_rank);

        const existingBinding = this.db
          .prepare(
            `SELECT id, role_rank FROM role_bindings
             WHERE workspace_id = ? AND principal_type = 'user' AND principal_key = ?
               AND resource_type = ? AND resource_key = ?`
          )
          .get(wsId, userId, resType, resKey) as { id: string; role_rank: number } | undefined;

        if (existingBinding) {
          if (pendingRank > existingBinding.role_rank) {
            this.db
              .prepare('UPDATE role_bindings SET role_rank = ? WHERE id = ?')
              .run(pendingRank, existingBinding.id);
          }
          this.db.prepare('DELETE FROM role_bindings WHERE id = ?').run(String(pending.id));
        } else {
          this.db
            .prepare(
              "UPDATE role_bindings SET principal_type = 'user', principal_key = ? WHERE id = ?"
            )
            .run(userId, String(pending.id));
        }
        claimedInvites++;
      }

      if (claimedInvites > 0) {
        this.recordAudit({
          actorUserId: userId,
          actorEmail: email,
          viaAgent: 'web',
          action: 'INVITE_CLAIMED',
          resourceType: 'user',
          resourceId: userId,
          details: { claimedInvites },
        });
      }

      this.db.exec('COMMIT;');
      return {
        user,
        personalWorkspace: this.mapWorkspace(personalWsRow, 'owner'),
        claimedInvites,
      };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  async getUserById(userId: string): Promise<UserProfile | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapUser(row) : null;
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : null;
  }

  async createAuthSession(input: CreateSessionInput): Promise<AuthSessionInfo> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_sessions (
          id, user_id, session_kind, refresh_token_hash, prev_refresh_token_hash, prev_grace_until,
          scope_ceiling_json, default_workspace_id, device_label, created_at, last_used_at, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        id,
        input.userId,
        input.sessionKind,
        input.refreshTokenHash,
        JSON.stringify(input.scopeCeiling),
        input.defaultWorkspaceId || null,
        input.deviceLabel || '',
        now,
        now,
        input.expiresAt
      );
    const row = this.db
      .prepare('SELECT * FROM auth_sessions WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return this.mapSession(row);
  }

  async getAuthSession(sessionId: string): Promise<AuthSessionInfo | null> {
    const row = this.db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapSession(row) : null;
  }

  async listUserSessions(userId: string): Promise<AuthSessionInfo[]> {
    const rows = this.db
      .prepare('SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapSession(r));
  }

  async rotateRefreshToken(input: RotateRefreshInput): Promise<RotateRefreshResult> {
    const graceMs = input.graceWindowMs ?? 30_000;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const graceUntilIso = new Date(nowMs + graceMs).toISOString();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.db
        .prepare(
          'SELECT * FROM auth_sessions WHERE refresh_token_hash = ? OR prev_refresh_token_hash = ?'
        )
        .get(input.presentedTokenHash, input.presentedTokenHash) as
        | Record<string, unknown>
        | undefined;

      if (!row) {
        throw new CloudPermissionError('Invalid refresh token', 401, 'unauthenticated');
      }
      if (row.revoked_at) {
        throw new CloudPermissionError('Session has been revoked', 401, 'unauthenticated');
      }
      if (Date.parse(String(row.expires_at)) <= nowMs) {
        throw new CloudPermissionError('Refresh token has expired', 401, 'unauthenticated');
      }

      const sessionId = String(row.id);
      const userId = String(row.user_id);
      let usedGraceWindow = false;

      if (String(row.prev_refresh_token_hash || '') === input.presentedTokenHash) {
        const graceUntilMs = row.prev_grace_until ? Date.parse(String(row.prev_grace_until)) : 0;
        if (!graceUntilMs || nowMs > graceUntilMs) {
          // Replay outside grace window: revoke whole session immediately
          this.db
            .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?')
            .run(nowIso, sessionId);
          this.recordAudit({
            actorUserId: userId,
            viaAgent: 'auth',
            action: 'SESSION_REPLAY_DETECTED',
            resourceType: 'auth_session',
            resourceId: sessionId,
          });
          this.db.exec('COMMIT;');
          throw new CloudPermissionError(
            'Refresh token replay detected; session revoked',
            401,
            'unauthenticated'
          );
        }
        usedGraceWindow = true;
      }

      const nextExpiresAt = capSessionExpiresAt(
        String(row.session_kind),
        String(row.created_at),
        input.nextExpiresAt,
        nowMs
      );
      this.db
        .prepare(
          `UPDATE auth_sessions
           SET prev_refresh_token_hash = refresh_token_hash,
               refresh_token_hash = ?,
               prev_grace_until = ?,
               last_used_at = ?,
               expires_at = ?
           WHERE id = ?`
        )
        .run(input.nextRefreshTokenHash, graceUntilIso, nowIso, nextExpiresAt, sessionId);

      const updatedRow = this.db
        .prepare('SELECT * FROM auth_sessions WHERE id = ?')
        .get(sessionId) as Record<string, unknown>;
      const userRow = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as Record<string, unknown> | undefined;

      if (!userRow) {
        throw new CloudPermissionError('User not found', 401, 'unauthenticated');
      }

      this.db.exec('COMMIT;');
      return {
        session: this.mapSession(updatedRow),
        user: this.mapUser(userRow),
        usedGraceWindow,
      };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignore if already committed above on replay detection
      }
      throw err;
    }
  }

  async revokeSession(sessionId: string, actorUserId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const res = this.db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?')
      .run(now, sessionId, actorUserId);
    return Number(res.changes) > 0;
  }

  async saveOAuthState(record: OAuthStateRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO oauth_states (
          state, nonce, code_verifier, flow_kind, redirect_uri, cli_challenge, cli_redirect_uri, cli_state, elevate, requested_workspace, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.state,
        record.nonce,
        record.codeVerifier,
        record.flowKind,
        record.redirectUri,
        record.cliChallenge || null,
        record.cliRedirectUri || null,
        record.cliState || null,
        record.elevate ? 1 : 0,
        record.requestedWorkspace || null,
        record.expiresAt
      );
  }

  async consumeOAuthState(state: string): Promise<OAuthStateRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    if (Date.parse(String(row.expires_at)) <= Date.now()) {
      return null;
    }
    return {
      state: String(row.state),
      nonce: String(row.nonce),
      codeVerifier: String(row.code_verifier),
      flowKind: String(row.flow_kind) as 'web' | 'cli_loopback',
      redirectUri: String(row.redirect_uri),
      ...(row.cli_challenge ? { cliChallenge: String(row.cli_challenge) } : {}),
      ...(row.cli_redirect_uri ? { cliRedirectUri: String(row.cli_redirect_uri) } : {}),
      ...(row.cli_state ? { cliState: String(row.cli_state) } : {}),
      elevate: Number(row.elevate) === 1,
      ...(row.requested_workspace ? { requestedWorkspace: String(row.requested_workspace) } : {}),
      expiresAt: String(row.expires_at),
    };
  }

  async saveCliAuthCode(record: CliAuthCodeRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO cli_auth_codes (
          code_hash, user_id, code_challenge, redirect_uri, elevate, default_workspace_id, device_label, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        record.codeHash,
        record.userId,
        record.codeChallenge,
        record.redirectUri,
        record.elevate ? 1 : 0,
        record.defaultWorkspaceId || null,
        record.deviceLabel || '',
        record.expiresAt
      );
  }

  async consumeCliAuthCode(codeHash: string): Promise<CliAuthCodeRecord | null> {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.db
        .prepare('SELECT * FROM cli_auth_codes WHERE code_hash = ?')
        .get(codeHash) as Record<string, unknown> | undefined;
      if (!row || row.consumed_at || Date.parse(String(row.expires_at)) <= Date.now()) {
        this.db.exec('COMMIT;');
        return null;
      }
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE cli_auth_codes SET consumed_at = ? WHERE code_hash = ?')
        .run(now, codeHash);
      this.db.exec('COMMIT;');
      return {
        codeHash: String(row.code_hash),
        userId: String(row.user_id),
        codeChallenge: String(row.code_challenge),
        redirectUri: String(row.redirect_uri),
        elevate: Number(row.elevate) === 1,
        ...(row.default_workspace_id
          ? { defaultWorkspaceId: String(row.default_workspace_id) }
          : {}),
        deviceLabel: String(row.device_label || ''),
        expiresAt: String(row.expires_at),
        consumedAt: now,
      };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  async createDeviceAuthCode(record: DeviceAuthRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO device_auth_codes (
          device_code_hash, user_code, status, user_id, elevate, default_workspace_id, device_label, interval_sec, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.deviceCodeHash,
        record.userCode,
        record.status,
        record.userId || null,
        record.elevate ? 1 : 0,
        record.defaultWorkspaceId || null,
        record.deviceLabel || '',
        record.intervalSec,
        record.expiresAt,
        record.createdAt
      );
  }

  private mapDeviceCode(row: Record<string, unknown>): DeviceAuthRecord {
    return {
      deviceCodeHash: String(row.device_code_hash),
      userCode: String(row.user_code),
      status: String(row.status) as DeviceAuthRecord['status'],
      ...(row.user_id ? { userId: String(row.user_id) } : {}),
      elevate: Number(row.elevate) === 1,
      ...(row.default_workspace_id
        ? { defaultWorkspaceId: String(row.default_workspace_id) }
        : {}),
      deviceLabel: String(row.device_label || ''),
      intervalSec: Number(row.interval_sec || 2),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
    };
  }

  async getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM device_auth_codes WHERE UPPER(user_code) = UPPER(?)')
      .get(userCode.trim()) as Record<string, unknown> | undefined;
    return row ? this.mapDeviceCode(row) : null;
  }

  async getDeviceAuthByDeviceCodeHash(deviceCodeHash: string): Promise<DeviceAuthRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM device_auth_codes WHERE device_code_hash = ?')
      .get(deviceCodeHash) as Record<string, unknown> | undefined;
    return row ? this.mapDeviceCode(row) : null;
  }

  async approveDeviceAuthCode(
    userCode: string,
    userId: string,
    defaultWorkspaceId?: string,
    elevate?: boolean
  ): Promise<DeviceAuthRecord | null> {
    const existing = await this.getDeviceAuthByUserCode(userCode);
    if (!existing || existing.status !== 'pending' || Date.parse(existing.expiresAt) <= Date.now()) {
      return null;
    }
    this.db
      .prepare(
        `UPDATE device_auth_codes
         SET status = 'approved', user_id = ?, default_workspace_id = COALESCE(?, default_workspace_id), elevate = COALESCE(?, elevate)
         WHERE device_code_hash = ?`
      )
      .run(
        userId,
        defaultWorkspaceId || null,
        elevate === undefined ? null : elevate ? 1 : 0,
        existing.deviceCodeHash
      );
    return this.getDeviceAuthByDeviceCodeHash(existing.deviceCodeHash);
  }

  async consumeDeviceAuthCode(deviceCodeHash: string): Promise<DeviceAuthRecord | null> {
    const existing = await this.getDeviceAuthByDeviceCodeHash(deviceCodeHash);
    if (
      !existing ||
      existing.status !== 'approved' ||
      !existing.userId ||
      Date.parse(existing.expiresAt) <= Date.now()
    ) {
      return null;
    }
    this.db
      .prepare("UPDATE device_auth_codes SET status = 'consumed' WHERE device_code_hash = ?")
      .run(deviceCodeHash);
    return { ...existing, status: 'consumed' };
  }

  private getUserGroupIds(workspaceId: string, email: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT g.id FROM groups g
         INNER JOIN group_members gm ON gm.group_id = g.id
         WHERE g.workspace_id = ? AND LOWER(gm.member_email) = ?`
      )
      .all(workspaceId, email.trim().toLowerCase()) as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  private matchesBindingPrincipal(
    bindingRow: Record<string, unknown>,
    ctx: AuthPrincipalContext,
    groupIds: Set<string>
  ): boolean {
    if (!ctx.authenticated || !ctx.user) return false;
    if (!isBindingActive({ expiresAt: bindingRow.expires_at ? String(bindingRow.expires_at) : undefined })) {
      return false;
    }
    const pType = String(bindingRow.principal_type) as PrincipalType;
    const pKey = String(bindingRow.principal_key);
    if (pType === 'user') return pKey === ctx.user.id;
    if (pType === 'group') return groupIds.has(pKey);
    if (pType === 'domain') {
      // Strictly match verified Google OIDC `hd` claim — NEVER email.split('@')[1]
      return Boolean(
        ctx.user.emailVerified &&
          ctx.user.googleHd &&
          ctx.user.googleHd.toLowerCase() === pKey.toLowerCase()
      );
    }
    return false;
  }

  async resolveWorkspaceRole(ctx: AuthPrincipalContext, workspaceId: string): Promise<Role | null> {
    if (!ctx.authenticated || !ctx.user) return null;
    const groupIds = this.getUserGroupIds(workspaceId, ctx.user.email);
    const rows = this.db
      .prepare(
        "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'workspace' AND resource_key = ?"
      )
      .all(workspaceId, workspaceId) as Record<string, unknown>[];
    const ranks: number[] = [];
    for (const r of rows) {
      if (this.matchesBindingPrincipal(r, ctx, groupIds)) {
        ranks.push(Number(r.role_rank));
      }
    }
    return computeMaxRoleRank(ranks);
  }

  private resolveProjectRow(workspaceId: string, projectSlug: string): Record<string, unknown> | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE workspace_id = ? AND LOWER(slug) = LOWER(?)')
      .get(workspaceId, projectSlug) as Record<string, unknown> | undefined;
    return row || null;
  }

  private resolveProjectRank(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectRow: Record<string, unknown> | null,
    projectSlug: string,
    groupIds: Set<string>
  ): number {
    const ranks: number[] = [];
    const inheritWs = projectRow ? Number(projectRow.inherit_workspace_acl) === 1 : true;

    const wsRows = this.db
      .prepare(
        "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'workspace' AND resource_key = ?"
      )
      .all(workspaceId, workspaceId) as Record<string, unknown>[];

    for (const r of wsRows) {
      if (this.matchesBindingPrincipal(r, ctx, groupIds)) {
        const rank = Number(r.role_rank);
        // On Private Projects (inherit_workspace_acl = false), only workspace owners cascade
        if (inheritWs || rank >= ROLE_RANK.owner) {
          ranks.push(rank);
        }
      }
    }

    if (projectRow) {
      const projId = String(projectRow.id);
      const projRows = this.db
        .prepare(
          "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'project' AND resource_key = ?"
        )
        .all(workspaceId, projId) as Record<string, unknown>[];
      for (const r of projRows) {
        if (this.matchesBindingPrincipal(r, ctx, groupIds)) {
          ranks.push(Number(r.role_rank));
        }
      }
    }

    if (ctx.shareLink && ctx.shareLink.workspaceId === workspaceId) {
      const linkCheck = isShareLinkValidForContext(ctx.shareLink, ctx);
      if (
        linkCheck.valid &&
        ctx.shareLink.targetSpec.kind === 'project' &&
        (ctx.shareLink.targetSpec.projectSlug || '').toLowerCase() === projectSlug.toLowerCase()
      ) {
        ranks.push(ROLE_RANK[ctx.shareLink.role]);
      }
    }

    return ranks.length > 0 ? Math.max(...ranks) : 0;
  }

  private resolveArtifactRank(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    artRow: Record<string, unknown>,
    groupIds?: Set<string>
  ): number {
    const groups = groupIds ?? (ctx.user ? this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>());
    const projectId = String(artRow.project_id);
    const projectSlug = String(artRow.project_slug);
    const category = String(artRow.category || '');
    const artifactId = String(artRow.id);

    const projectRow = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId) as Record<string, unknown> | undefined;

    const ranks: number[] = [];
    const projRank = this.resolveProjectRank(ctx, workspaceId, projectRow || null, projectSlug, groups);
    if (projRank > 0) ranks.push(projRank);

    // Matching category prefix bindings
    const catRows = this.db
      .prepare("SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'category'")
      .all(workspaceId) as Record<string, unknown>[];
    for (const r of catRows) {
      const resKey = String(r.resource_key);
      if (!resKey.startsWith(`${projectId}:`)) continue;
      const prefix = resKey.slice(projectId.length + 1);
      if (matchesCategoryPrefix(category, prefix) && this.matchesBindingPrincipal(r, ctx, groups)) {
        ranks.push(Number(r.role_rank));
      }
    }

    // Direct artifact bindings
    const artRows = this.db
      .prepare(
        "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'artifact' AND resource_key = ?"
      )
      .all(workspaceId, artifactId) as Record<string, unknown>[];
    for (const r of artRows) {
      if (this.matchesBindingPrincipal(r, ctx, groups)) {
        ranks.push(Number(r.role_rank));
      }
    }

    // Active share link
    if (ctx.shareLink && ctx.shareLink.workspaceId === workspaceId) {
      const linkCheck = isShareLinkValidForContext(ctx.shareLink, ctx);
      if (
        linkCheck.valid &&
        shareLinkCoversArtifact(ctx.shareLink, { id: artifactId, project: projectSlug, category })
      ) {
        ranks.push(ROLE_RANK[ctx.shareLink.role]);
      }
    }

    return ranks.length > 0 ? Math.max(...ranks) : 0;
  }

  async resolveArtifactRole(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<{ artifact: ArtifactMetadata; role: Role | null } | null> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return null;
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    const role = rankToRole(rank);
    return {
      artifact: this.mapArtifactMetadata(row, role || undefined),
      role,
    };
  }

  async listWorkspacesForUser(userId: string, googleHd?: string): Promise<Workspace[]> {
    const user = await this.getUserById(userId);
    if (!user) return [];
    const allWs = this.db
      .prepare('SELECT * FROM workspaces ORDER BY is_personal DESC, created_at ASC')
      .all() as Record<string, unknown>[];
    const ctx: AuthPrincipalContext = {
      authenticated: true,
      user: { ...user, ...(googleHd ? { googleHd } : {}) },
      scopes: ['artifacts:read'],
      viaAgent: 'web',
    };

    const result: Workspace[] = [];
    for (const wsRow of allWs) {
      const wsId = String(wsRow.id);
      const wsRole = await this.resolveWorkspaceRole(ctx, wsId);
      if (wsRole) {
        result.push(this.mapWorkspace(wsRow, wsRole));
        continue;
      }
      // Also surface workspaces where the user holds any direct project/category/artifact binding
      const groupIds = this.getUserGroupIds(wsId, user.email);
      const allBindings = this.db
        .prepare('SELECT * FROM role_bindings WHERE workspace_id = ?')
        .all(wsId) as Record<string, unknown>[];
      const hasChildAccess = allBindings.some((b) =>
        this.matchesBindingPrincipal(b, ctx, groupIds)
      );
      if (hasChildAccess) {
        result.push(this.mapWorkspace(wsRow, 'viewer'));
      }
    }
    return result;
  }

  async getWorkspace(idOrSlug: string): Promise<Workspace | null> {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ? OR LOWER(slug) = LOWER(?)')
      .get(idOrSlug, idOrSlug) as Record<string, unknown> | undefined;
    return row ? this.mapWorkspace(row) : null;
  }

  async createWorkspace(
    ctx: AuthPrincipalContext,
    input: { slug?: string; name: string; allowedGoogleHd?: string }
  ): Promise<Workspace> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    const id = crypto.randomUUID();
    const slug = this.uniqueWorkspaceSlug(input.slug || input.name);
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(
          `INSERT INTO workspaces (id, slug, name, is_personal, allowed_google_hd, created_by, created_at)
           VALUES (?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          id,
          slug,
          input.name.trim() || slug,
          input.allowedGoogleHd ? input.allowedGoogleHd.trim().toLowerCase() : null,
          ctx.user.id,
          now
        );

      this.db
        .prepare(
          `INSERT INTO role_bindings (id, workspace_id, principal_type, principal_key, resource_type, resource_key, role_rank, granted_by, expires_at, created_at)
           VALUES (?, ?, 'user', ?, 'workspace', ?, 40, ?, NULL, ?)`
        )
        .run(crypto.randomUUID(), id, ctx.user.id, id, ctx.user.id, now);

      this.recordAudit({
        workspaceId: id,
        ctx,
        action: 'WORKSPACE_CREATE',
        resourceType: 'workspace',
        resourceId: id,
        details: { slug, name: input.name },
      });
      this.db.exec('COMMIT;');
      const row = this.db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(id) as Record<string, unknown>;
      return this.mapWorkspace(row, 'owner');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  private ensureProjectRecord(
    workspaceId: string,
    projectSlugRaw: string,
    actorUserId: string
  ): Record<string, unknown> {
    const slug = normalizeProjectName(projectSlugRaw) || 'general';
    const existing = this.resolveProjectRow(workspaceId, slug);
    if (existing) return existing;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, slug, name, inherit_workspace_acl, created_by, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, workspaceId, slug, slug, actorUserId, now);
    return this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as Record<string, unknown>;
  }

  async listProjects(ctx: AuthPrincipalContext, workspaceId: string): Promise<WorkspaceProject[]> {
    const groupIds = ctx.user ? this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY slug ASC')
      .all(workspaceId) as Record<string, unknown>[];
    const visible: WorkspaceProject[] = [];
    for (const r of rows) {
      const rank = this.resolveProjectRank(ctx, workspaceId, r, String(r.slug), groupIds);
      const hasAnyArtifactInProj = (
        this.db
          .prepare('SELECT * FROM artifacts WHERE workspace_id = ? AND project_id = ?')
          .all(workspaceId, String(r.id)) as Record<string, unknown>[]
      ).some((art) => this.resolveArtifactRank(ctx, workspaceId, art, groupIds) > 0);
      if (rank >= ROLE_RANK.viewer || hasAnyArtifactInProj) {
        visible.push({
          id: String(r.id),
          workspaceId: String(r.workspace_id),
          slug: String(r.slug),
          name: String(r.name),
          inheritWorkspaceAcl: Number(r.inherit_workspace_acl) === 1,
          createdBy: String(r.created_by),
          createdAt: String(r.created_at),
        });
      }
    }
    return visible;
  }

  async setProjectVisibility(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectSlug: string,
    inheritWorkspaceAcl: boolean
  ): Promise<WorkspaceProject> {
    const cleanSlug = normalizeProjectName(projectSlug) || slugify(projectSlug);
    const projRow = this.resolveProjectRow(workspaceId, cleanSlug);
    if (!projRow) {
      throw new CloudPermissionError(`Project not found: ${projectSlug}`, 404, 'not_found');
    }
    const groupIds = ctx.user ? this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const rank = this.resolveProjectRank(ctx, workspaceId, projRow, cleanSlug, groupIds);
    evaluateAccess(rankToRole(rank), ctx, 'iam:share', `project ${cleanSlug}`);

    this.db
      .prepare('UPDATE projects SET inherit_workspace_acl = ? WHERE id = ?')
      .run(inheritWorkspaceAcl ? 1 : 0, String(projRow.id));

    this.recordAudit({
      workspaceId,
      ctx,
      action: 'PROJECT_VISIBILITY_SET',
      resourceType: 'project',
      resourceId: String(projRow.id),
      details: { projectSlug: cleanSlug, inheritWorkspaceAcl },
    });

    const updated = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(String(projRow.id)) as Record<string, unknown>;
    return {
      id: String(updated.id),
      workspaceId: String(updated.workspace_id),
      slug: String(updated.slug),
      name: String(updated.name),
      inheritWorkspaceAcl: Number(updated.inherit_workspace_acl) === 1,
      createdBy: String(updated.created_by),
      createdAt: String(updated.created_at),
    };
  }

  private hydrateGroup(row: Record<string, unknown>): WorkspaceGroup {
    const members = this.db
      .prepare('SELECT member_email FROM group_members WHERE group_id = ? ORDER BY member_email ASC')
      .all(String(row.id)) as Array<{ member_email: string }>;
    const memberEmails = members.map((m) => m.member_email);
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      slug: String(row.slug),
      name: String(row.name),
      description: String(row.description || ''),
      memberEmails,
      memberCount: memberEmails.length,
      createdAt: String(row.created_at),
    };
  }

  async listGroups(ctx: AuthPrincipalContext, workspaceId: string): Promise<WorkspaceGroup[]> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'artifact:read', `workspace ${workspaceId}`);
    const rows = this.db
      .prepare('SELECT * FROM groups WHERE workspace_id = ? ORDER BY name ASC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateGroup(r));
  }

  async createGroup(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: { slug?: string; name: string; description?: string; memberEmails?: string[] }
  ): Promise<WorkspaceGroup> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
    const id = crypto.randomUUID();
    const baseSlug = slugify(input.slug || input.name) || 'team';
    let slug = baseSlug;
    let c = 2;
    while (
      this.db
        .prepare('SELECT 1 FROM groups WHERE workspace_id = ? AND LOWER(slug) = LOWER(?)')
        .get(workspaceId, slug)
    ) {
      slug = `${baseSlug}-${c++}`;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO groups (id, workspace_id, slug, name, description, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workspaceId, slug, input.name.trim() || slug, input.description || '', ctx.user!.id, now);

    for (const rawEmail of input.memberEmails || []) {
      const email = rawEmail.trim().toLowerCase();
      if (!email) continue;
      this.db
        .prepare(
          'INSERT OR IGNORE INTO group_members (group_id, member_email, added_by, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(id, email, ctx.user!.id, now);
    }

    const row = this.db
      .prepare('SELECT * FROM groups WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return this.hydrateGroup(row);
  }

  async updateGroupMembers(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    groupIdOrSlug: string,
    input: { addEmails?: string[]; removeEmails?: string[] }
  ): Promise<WorkspaceGroup> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
    const row = this.db
      .prepare(
        'SELECT * FROM groups WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))'
      )
      .get(workspaceId, groupIdOrSlug, groupIdOrSlug) as Record<string, unknown> | undefined;
    if (!row) {
      throw new CloudPermissionError(`Group not found: ${groupIdOrSlug}`, 404, 'not_found');
    }
    const groupId = String(row.id);
    const now = new Date().toISOString();
    for (const rawEmail of input.addEmails || []) {
      const email = rawEmail.trim().toLowerCase();
      if (email) {
        this.db
          .prepare(
            'INSERT OR IGNORE INTO group_members (group_id, member_email, added_by, created_at) VALUES (?, ?, ?, ?)'
          )
          .run(groupId, email, ctx.user!.id, now);
      }
    }
    for (const rawEmail of input.removeEmails || []) {
      const email = rawEmail.trim().toLowerCase();
      if (email) {
        this.db
          .prepare('DELETE FROM group_members WHERE group_id = ? AND LOWER(member_email) = ?')
          .run(groupId, email);
      }
    }
    return this.hydrateGroup(row);
  }

  async getResourceAcl(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    resourceType: ResourceType,
    resourceKey: string
  ): Promise<EffectiveAclDetail> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError(
        'Authentication required to inspect ACL bindings',
        401,
        'unauthenticated'
      );
    }
    const authCtx: AuthPrincipalContext = ctx.shareLink ? { ...ctx, shareLink: undefined } : ctx;

    let resolvedKey = resourceKey;
    let projectRow: Record<string, unknown> | null = null;
    let artRow: Record<string, unknown> | null = null;

    if (resourceType === 'workspace') {
      resolvedKey = workspaceId;
      const role = await this.resolveWorkspaceRole(authCtx, workspaceId);
      evaluateAccess(role, authCtx, 'artifact:read', `workspace ${workspaceId}`);
    } else if (resourceType === 'project') {
      projectRow =
        (this.db
          .prepare('SELECT * FROM projects WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))')
          .get(workspaceId, resourceKey, resourceKey) as Record<string, unknown> | undefined) || null;
      if (!projectRow) throw new CloudPermissionError('Project not found', 404, 'not_found');
      resolvedKey = String(projectRow.id);
      const groupIds = this.getUserGroupIds(workspaceId, authCtx.user!.email);
      const rank = this.resolveProjectRank(authCtx, workspaceId, projectRow, String(projectRow.slug), groupIds);
      evaluateAccess(rankToRole(rank), authCtx, 'artifact:read', `project ${projectRow.slug}`);
    } else if (resourceType === 'category') {
      const [projRef, ...rest] = resourceKey.split(':');
      const prefix = rest.join(':');
      projectRow =
        (this.db
          .prepare('SELECT * FROM projects WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))')
          .get(workspaceId, projRef, projRef) as Record<string, unknown> | undefined) || null;
      if (!projectRow) throw new CloudPermissionError('Project not found for category', 404, 'not_found');
      resolvedKey = normalizeCategoryKey(String(projectRow.id), prefix);
      const groupIds = this.getUserGroupIds(workspaceId, authCtx.user!.email);
      const rank = this.resolveProjectRank(authCtx, workspaceId, projectRow, String(projectRow.slug), groupIds);
      evaluateAccess(rankToRole(rank), authCtx, 'artifact:read', `category ${resolvedKey}`);
    } else if (resourceType === 'artifact') {
      artRow = this.findArtifactRow(workspaceId, resourceKey);
      if (!artRow) throw new CloudPermissionError('Artifact not found', 404, 'not_found');
      resolvedKey = String(artRow.id);
      const rank = this.resolveArtifactRank(authCtx, workspaceId, artRow);
      evaluateAccess(rankToRole(rank), authCtx, 'artifact:read', `artifact ${artRow.slug}`);
    } else {
      throw new CloudPermissionError('Invalid resourceType', 400, 'insufficient_role');
    }

    const directRows = this.db
      .prepare(
        'SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = ? AND resource_key = ? ORDER BY role_rank DESC, created_at ASC'
      )
      .all(workspaceId, resourceType, resolvedKey) as Record<string, unknown>[];

    const inheritedBindings: EffectiveAclDetail['inheritedBindings'] = [];

    if (resourceType === 'project' && projectRow) {
      const inheritWs = Number(projectRow.inherit_workspace_acl) === 1;
      const wsRows = this.db
        .prepare(
          "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'workspace' AND resource_key = ?"
        )
        .all(workspaceId, workspaceId) as Record<string, unknown>[];
      for (const r of wsRows) {
        if (inheritWs || Number(r.role_rank) >= ROLE_RANK.owner) {
          inheritedBindings.push({
            ...this.mapBinding(r),
            inheritedFrom: 'workspace',
            inheritedFromKey: workspaceId,
          });
        }
      }
    } else if (resourceType === 'artifact' && artRow) {
      const pRow = this.db
        .prepare('SELECT * FROM projects WHERE id = ?')
        .get(String(artRow.project_id)) as Record<string, unknown> | undefined;
      const inheritWs = pRow ? Number(pRow.inherit_workspace_acl) === 1 : true;
      const wsRows = this.db
        .prepare(
          "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'workspace' AND resource_key = ?"
        )
        .all(workspaceId, workspaceId) as Record<string, unknown>[];
      for (const r of wsRows) {
        if (inheritWs || Number(r.role_rank) >= ROLE_RANK.owner) {
          inheritedBindings.push({
            ...this.mapBinding(r),
            inheritedFrom: 'workspace',
            inheritedFromKey: workspaceId,
          });
        }
      }
      const projRows = this.db
        .prepare(
          "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'project' AND resource_key = ?"
        )
        .all(workspaceId, String(artRow.project_id)) as Record<string, unknown>[];
      for (const r of projRows) {
        inheritedBindings.push({
          ...this.mapBinding(r),
          inheritedFrom: 'project',
          inheritedFromKey: String(artRow.project_slug),
        });
      }
      const catRows = this.db
        .prepare("SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'category'")
        .all(workspaceId) as Record<string, unknown>[];
      for (const r of catRows) {
        const rk = String(r.resource_key);
        if (rk.startsWith(`${artRow.project_id}:`)) {
          const prefix = rk.slice(String(artRow.project_id).length + 1);
          if (matchesCategoryPrefix(String(artRow.category || ''), prefix)) {
            inheritedBindings.push({
              ...this.mapBinding(r),
              inheritedFrom: 'category',
              inheritedFromKey: prefix,
            });
          }
        }
      }
    }

    return {
      resourceType,
      resourceKey: resolvedKey,
      directBindings: directRows.map((r) => this.mapBinding(r)),
      inheritedBindings,
      ...(projectRow ? { inheritWorkspaceAcl: Number(projectRow.inherit_workspace_acl) === 1 } : {}),
    };
  }

  private resolveBatchTargets(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    specs: BatchShareRequest['resources'],
    requireSharePermission: boolean
  ): Array<{ resourceType: ResourceType; resourceKey: string; actorRank: number }> {
    const out: Array<{ resourceType: ResourceType; resourceKey: string; actorRank: number }> = [];
    const seen = new Set<string>();
    const groupIds = ctx.user ? this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();

    const pushTarget = (resourceType: ResourceType, resourceKey: string, actorRank: number) => {
      const k = `${resourceType}:${resourceKey}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ resourceType, resourceKey, actorRank });
      }
    };

    for (const spec of specs) {
      if (!spec || typeof spec !== 'object') {
        throw new CloudPermissionError('Invalid resource target specification', 400, 'insufficient_role');
      }
      if (spec.type === 'workspace') {
        const wsRole = this.syncResolveWorkspaceRole(ctx, workspaceId, groupIds);
        if (requireSharePermission) {
          evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
        }
        const actorRank = wsRole ? ROLE_RANK[wsRole] : 0;
        pushTarget('workspace', workspaceId, actorRank);
      } else if (spec.type === 'project') {
        if (typeof spec.id !== 'string' || !spec.id) {
          throw new CloudPermissionError('Invalid project target id', 400, 'insufficient_role');
        }
        const proj = this.db
          .prepare('SELECT * FROM projects WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))')
          .get(workspaceId, spec.id, spec.id) as Record<string, unknown> | undefined;
        if (!proj) {
          throw new CloudPermissionError(`Project not found: ${spec.id}`, 404, 'not_found');
        }
        const rank = this.resolveProjectRank(ctx, workspaceId, proj, String(proj.slug), groupIds);
        if (requireSharePermission) {
          evaluateAccess(rankToRole(rank), ctx, 'iam:share', `project ${proj.slug}`);
        }
        pushTarget('project', String(proj.id), rank);
      } else if (spec.type === 'category') {
        if (typeof spec.projectId !== 'string' || typeof spec.prefix !== 'string') {
          throw new CloudPermissionError('Invalid category target spec', 400, 'insufficient_role');
        }
        const proj = this.db
          .prepare('SELECT * FROM projects WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))')
          .get(workspaceId, spec.projectId, spec.projectId) as Record<string, unknown> | undefined;
        if (!proj) {
          throw new CloudPermissionError(`Project not found: ${spec.projectId}`, 404, 'not_found');
        }
        const rank = this.resolveProjectRank(ctx, workspaceId, proj, String(proj.slug), groupIds);
        if (requireSharePermission) {
          evaluateAccess(rankToRole(rank), ctx, 'iam:share', `category ${spec.prefix}`);
        }
        pushTarget('category', normalizeCategoryKey(String(proj.id), spec.prefix), rank);
      } else if (spec.type === 'artifact') {
        if (typeof spec.id !== 'string' || !spec.id) {
          throw new CloudPermissionError('Invalid artifact target id', 400, 'insufficient_role');
        }
        const art = this.findArtifactRow(workspaceId, spec.id);
        if (!art) {
          throw new CloudPermissionError(`Artifact not found: ${spec.id}`, 404, 'not_found');
        }
        const rank = this.resolveArtifactRank(ctx, workspaceId, art, groupIds);
        if (requireSharePermission) {
          evaluateAccess(rankToRole(rank), ctx, 'iam:share', `artifact ${art.slug}`);
        }
        pushTarget('artifact', String(art.id), rank);
      } else if (spec.type === 'filter') {
        if (requireSharePermission && !ctx.scopes.includes('iam:share')) {
          throw new CloudPermissionError(
            `Active session (${ctx.sessionKind || 'delegated'}) lacks scope "iam:share". Run "myartifact login --elevate" or use the Web Studio.`,
            403,
            'agent_scope_restricted'
          );
        }
        const rows = this.queryArtifactRows(workspaceId, {
          project: spec.project,
          tag: spec.tag,
          query: spec.query,
          limit: 500,
        });
        for (const art of rows) {
          const rank = this.resolveArtifactRank(ctx, workspaceId, art, groupIds);
          if (rank >= ROLE_RANK.admin && ctx.scopes.includes('iam:share')) {
            pushTarget('artifact', String(art.id), rank);
          }
        }
      } else {
        throw new CloudPermissionError('Invalid resource target type', 400, 'insufficient_role');
      }
    }
    return out;
  }

  private syncResolveWorkspaceRole(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    groupIds: Set<string>
  ): Role | null {
    if (!ctx.authenticated || !ctx.user) return null;
    const rows = this.db
      .prepare(
        "SELECT * FROM role_bindings WHERE workspace_id = ? AND resource_type = 'workspace' AND resource_key = ?"
      )
      .all(workspaceId, workspaceId) as Record<string, unknown>[];
    const ranks: number[] = [];
    for (const r of rows) {
      if (this.matchesBindingPrincipal(r, ctx, groupIds)) {
        ranks.push(Number(r.role_rank));
      }
    }
    return computeMaxRoleRank(ranks);
  }

  private resolveBatchPrincipals(
    workspaceId: string,
    specs: BatchShareRequest['principals']
  ): Array<{ principalType: PrincipalType; principalKey: string; pendingEmail?: string; userId?: string }> {
    const resolved: Array<{
      principalType: PrincipalType;
      principalKey: string;
      pendingEmail?: string;
      userId?: string;
    }> = [];
    const seen = new Set<string>();

    for (const p of specs) {
      if (!p || typeof p !== 'object') {
        throw new CloudPermissionError('Invalid principal specification', 400, 'insufficient_role');
      }
      if (p.type === 'email') {
        if (typeof p.email !== 'string') continue;
        const email = p.email.trim().toLowerCase();
        if (!email || !email.includes('@')) continue;
        const userRow = this.db
          .prepare('SELECT id FROM users WHERE LOWER(email) = ?')
          .get(email) as { id: string } | undefined;
        const pType: PrincipalType = userRow ? 'user' : 'pending_email';
        const pKey = userRow ? userRow.id : email;
        const dedupKey = `${pType}:${pKey}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          resolved.push({
            principalType: pType,
            principalKey: pKey,
            ...(userRow ? { userId: userRow.id } : { pendingEmail: email }),
          });
        }
      } else if (p.type === 'group') {
        if (typeof p.groupId !== 'string' || !p.groupId) {
          throw new CloudPermissionError('Invalid groupId', 400, 'insufficient_role');
        }
        const groupRow = this.db
          .prepare('SELECT id FROM groups WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))')
          .get(workspaceId, p.groupId, p.groupId) as { id: string } | undefined;
        if (!groupRow) {
          throw new CloudPermissionError(`Group not found: ${p.groupId}`, 404, 'not_found');
        }
        const dedupKey = `group:${groupRow.id}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          resolved.push({ principalType: 'group', principalKey: groupRow.id });
        }
      } else if (p.type === 'domain') {
        if (typeof p.domain !== 'string') continue;
        const dom = p.domain.trim().toLowerCase().replace(/^@+/, '');
        if (!dom || !dom.includes('.')) continue;
        const dedupKey = `domain:${dom}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          resolved.push({ principalType: 'domain', principalKey: dom });
        }
      } else {
        throw new CloudPermissionError('Invalid principal type', 400, 'insufficient_role');
      }
    }
    return resolved;
  }

  private assertHasOtherActiveWorkspaceOwner(workspaceId: string, excludeBindingId: string): void {
    const ownerRows = this.db
      .prepare(
        `SELECT id, expires_at FROM role_bindings
         WHERE workspace_id = ? AND resource_type = 'workspace' AND resource_key = ?
           AND principal_type = 'user' AND role_rank >= ? AND id != ?`
      )
      .all(workspaceId, workspaceId, ROLE_RANK.owner, excludeBindingId) as Array<{
      id: string;
      expires_at: string | null;
    }>;
    const hasOtherActiveOwner = ownerRows.some((r) =>
      isBindingActive({ expiresAt: r.expires_at ? String(r.expires_at) : undefined })
    );
    if (!hasOtherActiveOwner) {
      throw new CloudPermissionError(
        'Cannot remove or downgrade the last workspace owner',
        400,
        'insufficient_role'
      );
    }
  }

  async applyBatchGrants(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    request: BatchShareRequest
  ): Promise<BatchShareResult> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    assertBatchRequestShape(request);
    const { rank: targetRank } = parseBatchGrantRole((request as { role?: unknown }).role);
    if (
      request.mode !== undefined &&
      request.mode !== 'upgrade_only' &&
      request.mode !== 'set_exact'
    ) {
      throw new CloudPermissionError('Invalid batch grant mode', 400, 'insufficient_role');
    }
    const targets = this.resolveBatchTargets(ctx, workspaceId, request.resources, true);
    if (targets.length === 0) {
      throw new CloudPermissionError('No matching target resources found', 400, 'not_found');
    }
    for (const target of targets) {
      if (targetRank > target.actorRank) {
        throw new CloudPermissionError(
          'Cannot grant a role higher than your own effective role',
          403,
          'insufficient_role'
        );
      }
    }
    const principals = this.resolveBatchPrincipals(workspaceId, request.principals);
    const mode = request.mode || 'upgrade_only';
    const nextExpiresAt = request.expiresAt || null;
    const now = new Date().toISOString();

    let applied = 0;
    let upgraded = 0;
    let unchanged = 0;
    const pendingEmailInvites = new Set<string>();
    const resolvedUserIds = new Set<string>();
    const bindings: RoleBinding[] = [];

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const target of targets) {
        for (const principal of principals) {
          if (principal.pendingEmail) pendingEmailInvites.add(principal.pendingEmail);
          if (principal.userId) resolvedUserIds.add(principal.userId);

          const existing = this.db
            .prepare(
              `SELECT * FROM role_bindings
               WHERE workspace_id = ? AND principal_type = ? AND principal_key = ?
                 AND resource_type = ? AND resource_key = ?`
            )
            .get(
              workspaceId,
              principal.principalType,
              principal.principalKey,
              target.resourceType,
              target.resourceKey
            ) as Record<string, unknown> | undefined;

          if (existing) {
            const existingRank = Number(existing.role_rank);
            if (existingRank > target.actorRank) {
              throw new CloudPermissionError(
                'Cannot modify a binding higher than your own effective role',
                403,
                'insufficient_role'
              );
            }
            const existingExpiresAt = existing.expires_at ? String(existing.expires_at) : null;
            if (mode === 'upgrade_only' && existingRank >= targetRank) {
              unchanged++;
              bindings.push(this.mapBinding(existing));
            } else if (existingRank !== targetRank || nextExpiresAt !== existingExpiresAt) {
              const isDowngradingWorkspaceOwner =
                target.resourceType === 'workspace' &&
                existingRank >= ROLE_RANK.owner &&
                principal.principalType === 'user' &&
                (targetRank < ROLE_RANK.owner ||
                  (nextExpiresAt !== null && !isBindingActive({ expiresAt: nextExpiresAt })));
              if (isDowngradingWorkspaceOwner) {
                this.assertHasOtherActiveWorkspaceOwner(workspaceId, String(existing.id));
              }
              this.db
                .prepare(
                  'UPDATE role_bindings SET role_rank = ?, granted_by = ?, expires_at = ? WHERE id = ?'
                )
                .run(targetRank, ctx.user.id, nextExpiresAt, String(existing.id));
              upgraded++;
              const updatedRow = this.db
                .prepare('SELECT * FROM role_bindings WHERE id = ?')
                .get(String(existing.id)) as Record<string, unknown>;
              bindings.push(this.mapBinding(updatedRow));
            } else {
              unchanged++;
              bindings.push(this.mapBinding(existing));
            }
          } else {
            const id = crypto.randomUUID();
            this.db
              .prepare(
                `INSERT INTO role_bindings (
                  id, workspace_id, principal_type, principal_key, resource_type, resource_key, role_rank, granted_by, expires_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                workspaceId,
                principal.principalType,
                principal.principalKey,
                target.resourceType,
                target.resourceKey,
                targetRank,
                ctx.user.id,
                nextExpiresAt,
                now
              );
            applied++;
            const inserted = this.db
              .prepare('SELECT * FROM role_bindings WHERE id = ?')
              .get(id) as Record<string, unknown>;
            bindings.push(this.mapBinding(inserted));
          }
        }
      }

      this.recordAudit({
        workspaceId,
        ctx,
        action: 'BATCH_SHARE',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: {
          role: request.role,
          mode,
          targetCount: targets.length,
          principalCount: principals.length,
          applied,
          upgraded,
          pendingEmailInvites: Array.from(pendingEmailInvites),
        },
      });
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    await this.publish({
      type: 'acl:updated',
      workspaceId,
      payload: { type: 'acl:updated', workspaceId },
    });

    return {
      applied,
      upgraded,
      unchanged,
      pendingEmailInvites: Array.from(pendingEmailInvites),
      resolvedUserIds: Array.from(resolvedUserIds),
      targetResourceCount: targets.length,
      bindings,
    };
  }

  async revokeBatchGrants(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    request: BatchRevokeRequest
  ): Promise<{ revokedCount: number }> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    assertBatchRequestShape(request);
    const targets = this.resolveBatchTargets(ctx, workspaceId, request.resources, true);
    const principals = this.resolveBatchPrincipals(workspaceId, request.principals);
    let revokedCount = 0;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const target of targets) {
        for (const p of principals) {
          const existing = this.db
            .prepare(
              `SELECT * FROM role_bindings
               WHERE workspace_id = ? AND principal_type = ? AND principal_key = ?
                 AND resource_type = ? AND resource_key = ?`
            )
            .get(
              workspaceId,
              p.principalType,
              p.principalKey,
              target.resourceType,
              target.resourceKey
            ) as Record<string, unknown> | undefined;

          if (!existing) continue;

          const existingRank = Number(existing.role_rank);
          if (existingRank > target.actorRank) {
            throw new CloudPermissionError(
              'Cannot revoke a binding higher than your own effective role',
              403,
              'insufficient_role'
            );
          }

          if (
            target.resourceType === 'workspace' &&
            existingRank >= ROLE_RANK.owner &&
            p.principalType === 'user'
          ) {
            this.assertHasOtherActiveWorkspaceOwner(workspaceId, String(existing.id));
          }

          const info = this.db
            .prepare('DELETE FROM role_bindings WHERE id = ?')
            .run(String(existing.id));
          revokedCount += Number(info.changes);
        }
      }
      this.recordAudit({
        workspaceId,
        ctx,
        action: 'BATCH_REVOKE',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { revokedCount, targetCount: targets.length },
      });
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    await this.publish({
      type: 'acl:updated',
      workspaceId,
      payload: { type: 'acl:updated', workspaceId },
    });
    return { revokedCount };
  }

  async createShareLink(
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
  ): Promise<{ link: ShareLink; token: string }> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    if (input.role !== 'viewer' && input.role !== 'editor') {
      throw new CloudPermissionError('Invalid share link role', 400, 'insufficient_role');
    }
    // Verify caller has iam:share on the targeted resources
    const specs: BatchShareRequest['resources'] = [];
    if (input.targetSpec.kind === 'project' && input.targetSpec.projectSlug) {
      specs.push({ type: 'project', id: input.targetSpec.projectSlug });
    } else if (input.targetSpec.kind === 'category' && input.targetSpec.projectSlug) {
      specs.push({
        type: 'category',
        projectId: input.targetSpec.projectSlug,
        prefix: input.targetSpec.categoryPrefix || '',
      });
    } else if (input.targetSpec.artifactIds?.length) {
      for (const id of input.targetSpec.artifactIds) {
        specs.push({ type: 'artifact', id });
      }
    }
    if (specs.length === 0) {
      specs.push({ type: 'workspace', id: workspaceId });
    }
    this.resolveBatchTargets(ctx, workspaceId, specs, true);

    const token = `ma_sl_${crypto.randomBytes(24).toString('base64url')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const requiredHd =
      input.accessMode === 'domain'
        ? (input.requiredHd || ctx.user.googleHd || '').trim().toLowerCase()
        : null;

    if (input.accessMode === 'domain' && !requiredHd) {
      throw new CloudPermissionError(
        'Domain share links require a Google Workspace domain (requiredHd)',
        400,
        'domain_mismatch'
      );
    }

    this.db
      .prepare(
        `INSERT INTO share_links (
          id, workspace_id, token_hash, token_prefix, access_mode, required_hd, role_rank, target_spec_json, label, created_by, expires_at, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        id,
        workspaceId,
        tokenHash,
        token.slice(0, 12),
        input.accessMode,
        requiredHd,
        ROLE_RANK[input.role],
        JSON.stringify(input.targetSpec),
        input.label || '',
        ctx.user.id,
        input.expiresAt || null,
        now
      );

    this.recordAudit({
      workspaceId,
      ctx,
      action: 'SHARE_LINK_CREATE',
      resourceType: 'share_link',
      resourceId: id,
      details: { accessMode: input.accessMode, requiredHd, role: input.role, targetSpec: input.targetSpec },
    });

    const row = this.db
      .prepare('SELECT * FROM share_links WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return { link: this.mapShareLink(row), token };
  }

  async listShareLinks(ctx: AuthPrincipalContext, workspaceId: string): Promise<ShareLink[]> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
    const rows = this.db
      .prepare('SELECT * FROM share_links WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapShareLink(r));
  }

  async revokeShareLink(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    linkId: string
  ): Promise<boolean> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
    const info = this.db
      .prepare('UPDATE share_links SET revoked_at = ? WHERE workspace_id = ? AND id = ?')
      .run(new Date().toISOString(), workspaceId, linkId);
    return Number(info.changes) > 0;
  }

  async resolveShareLinkByToken(token: string): Promise<ShareLink | null> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = this.db
      .prepare('SELECT * FROM share_links WHERE token_hash = ?')
      .get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapShareLink(row) : null;
  }

  async getShareLinkBundle(
    ctx: AuthPrincipalContext,
    token: string
  ): Promise<{ link: ShareLink; workspace: Workspace; artifacts: ArtifactMetadata[] }> {
    const link = await this.resolveShareLinkByToken(token);
    if (!link) {
      throw new CloudPermissionError('Share link not found', 404, 'not_found');
    }
    const validCheck = isShareLinkValidForContext(link, ctx);
    if (!validCheck.valid) {
      throw new CloudPermissionError(
        `Share link invalid (${validCheck.reason})`,
        validCheck.reason === 'unauthenticated' ? 401 : 403,
        validCheck.reason || 'insufficient_role'
      );
    }
    const ws = await this.getWorkspace(link.workspaceId);
    if (!ws) throw new CloudPermissionError('Workspace not found', 404, 'not_found');
    const linkCtx: AuthPrincipalContext = {
      ...ctx,
      shareLink: link,
      scopes: ctx.authenticated ? ctx.scopes : ['artifacts:read'],
    };
    const artifacts = await this.listArtifacts(linkCtx, link.workspaceId, { limit: 500 });
    return { link, workspace: ws, artifacts };
  }

  private findArtifactRow(
    workspaceId: string,
    idOrSlug: string
  ): Record<string, unknown> | null {
    const row = this.db
      .prepare(
        'SELECT * FROM artifacts WHERE workspace_id = ? AND (id = ? OR LOWER(slug) = LOWER(?))'
      )
      .get(workspaceId, idOrSlug, idOrSlug) as Record<string, unknown> | undefined;
    return row || null;
  }

  private mapArtifactMetadata(row: Record<string, unknown>, effectiveRole?: Role): ArtifactMetadata {
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
    const icon = resolveArtifactIconSvg({
      slug,
      title,
      type,
      tags,
      icon: String(row.icon || ''),
    });
    return {
      id: String(row.id),
      slug,
      title,
      description: String(row.description || ''),
      type,
      language: String(row.language || ''),
      agent: String(row.agent || 'user'),
      project: String(row.project_slug || 'general'),
      category: String(row.category || 'concepts/general'),
      tags,
      links,
      icon,
      currentVersion: Number(row.current_version || 1),
      filePath: `cas://${String(row.current_blob_sha256)}`,
      workspaceId: String(row.workspace_id),
      ...(row.author_user_id ? { authorUserId: String(row.author_user_id) } : {}),
      ...(row.author_email ? { authorEmail: String(row.author_email) } : {}),
      ...(effectiveRole ? { effectiveRole } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private updateFtsIndex(
    artifactId: string,
    workspaceId: string,
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
        'INSERT INTO artifacts_fts (artifact_id, workspace_id, slug, title, description, tags, content) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(artifactId, workspaceId, slug, title, description, enrichedTags, content);
  }

  private async hydrateArtifactDetail(
    row: Record<string, unknown>,
    effectiveRole?: Role
  ): Promise<ArtifactDetail> {
    const meta = this.mapArtifactMetadata(row, effectiveRole);
    const content = (await this.blobStore.getCasText(String(row.current_blob_sha256))) ?? '';
    const vRows = this.db
      .prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version ASC')
      .all(meta.id) as Record<string, unknown>[];
    const versions: ArtifactVersion[] = vRows.map((v) => ({
      artifactId: String(v.artifact_id),
      version: Number(v.version),
      agent: String(v.agent),
      summary: String(v.summary),
      filePath: `cas://${String(v.blob_sha256)}`,
      contentHash: String(v.blob_sha256),
      blobSha256: String(v.blob_sha256),
      ...(v.author_user_id ? { authorUserId: String(v.author_user_id) } : {}),
      ...(v.author_email ? { authorEmail: String(v.author_email) } : {}),
      byteSize: Number(v.byte_size || 0),
      createdAt: String(v.created_at),
    }));
    return { ...meta, content, versions };
  }

  async createArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: CreateArtifactInput
  ): Promise<ArtifactDetail> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const inferred = inferTypeFromPathOrContent(undefined, input.content);
    const type: ArtifactType = input.type || inferred.type;
    const language = input.language || inferred.language;
    const slug = this.uniqueArtifactSlug(workspaceId, input.slug || input.title);
    const agent = input.agent || ctx.viaAgent || 'user';
    const tags = input.tags || [];
    const projectSlug = inferWikiProject({
      slug,
      title: input.title,
      project: input.project,
      tags,
    });

    const groupIds = this.getUserGroupIds(workspaceId, ctx.user.email);
    const existingProj = this.resolveProjectRow(workspaceId, projectSlug);
    const wsRole = existingProj ? null : await this.resolveWorkspaceRole(ctx, workspaceId);
    const permRank = existingProj
      ? this.resolveProjectRank(ctx, workspaceId, existingProj, projectSlug, groupIds)
      : wsRole
      ? ROLE_RANK[wsRole]
      : 0;
    evaluateAccess(rankToRole(permRank), ctx, 'artifact:write', `project ${projectSlug}`);

    const projRow = existingProj || this.ensureProjectRecord(workspaceId, projectSlug, ctx.user.id);
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

    const blob = await this.blobStore.putCasText(input.content);

    this.db
      .prepare(
        `INSERT INTO artifacts (
          id, workspace_id, project_id, slug, title, description, type, language, agent, project_slug,
          category, tags_json, links_json, icon, current_version, current_blob_sha256, author_user_id, author_email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspaceId,
        String(projRow.id),
        slug,
        input.title,
        description,
        type,
        language,
        agent,
        String(projRow.slug),
        category,
        JSON.stringify(tags),
        JSON.stringify(links),
        icon,
        blob.sha256,
        ctx.user.id,
        ctx.user.email,
        now,
        now
      );

    this.db
      .prepare(
        `INSERT INTO artifact_versions (
          artifact_id, version, agent, summary, blob_sha256, byte_size, author_user_id, author_email, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, agent, summary, blob.sha256, blob.byteSize, ctx.user.id, ctx.user.email, now);

    this.updateFtsIndex(id, workspaceId, slug, input.title, description, category, tags, links, input.content);
    this.recordAudit({
      workspaceId,
      ctx,
      action: 'ARTIFACT_CREATE',
      resourceType: 'artifact',
      resourceId: id,
      details: { slug, version: 1, project: projRow.slug, viaAgent: ctx.viaAgent },
    });

    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(id) as Record<string, unknown>;
    const detail = await this.hydrateArtifactDetail(row, rankToRole(permRank) || 'editor');
    await this.publish({
      type: 'artifact:created',
      workspaceId,
      artifactId: detail.id,
      artifact: detail,
      payload: { type: 'artifact:created', artifact: detail },
    });
    return detail;
  }

  async updateArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    input: UpdateArtifactInput
  ): Promise<ArtifactDetail> {
    const existingRow = this.findArtifactRow(workspaceId, idOrSlug);
    if (!existingRow) {
      throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    }
    const existingRank = this.resolveArtifactRank(ctx, workspaceId, existingRow);
    const existingRole = rankToRole(existingRank);
    evaluateAccess(existingRole, ctx, 'artifact:write', `artifact ${existingRow.slug}`);

    const existingMeta = this.mapArtifactMetadata(existingRow, existingRole || undefined);
    const now = new Date().toISOString();
    const title = input.title ?? existingMeta.title;
    const inferredUpdate = inferTypeFromPathOrContent(undefined, input.content);
    const type: ArtifactType =
      input.type ?? (inferredUpdate.type !== 'markdown' ? inferredUpdate.type : existingMeta.type);
    const language =
      input.language ??
      (type !== existingMeta.type
        ? inferredUpdate.type === type
          ? inferredUpdate.language
          : getDefaultLanguageForType(type)
        : existingMeta.language);
    const agent = input.agent ?? existingMeta.agent;
    const tags = input.tags ?? existingMeta.tags;
    const projectSlug = inferWikiProject({
      slug: existingMeta.slug,
      title,
      project: input.project ?? existingMeta.project,
      tags,
    });
    if (projectSlug.toLowerCase() !== existingMeta.project.toLowerCase()) {
      const targetProj = this.resolveProjectRow(workspaceId, projectSlug);
      const groupIds = ctx.user
        ? this.getUserGroupIds(workspaceId, ctx.user.email)
        : new Set<string>();
      const targetWsRole = targetProj ? null : await this.resolveWorkspaceRole(ctx, workspaceId);
      const targetRank = targetProj
        ? this.resolveProjectRank(ctx, workspaceId, targetProj, projectSlug, groupIds)
        : targetWsRole
        ? ROLE_RANK[targetWsRole]
        : 0;
      evaluateAccess(rankToRole(targetRank), ctx, 'artifact:write', `target project ${projectSlug}`);
    }
    const projRow = this.ensureProjectRecord(
      workspaceId,
      projectSlug,
      ctx.user?.id || String(existingRow.author_user_id || '')
    );
    const category = inferWikiCategory({
      slug: existingMeta.slug,
      title,
      type,
      tags,
      category: input.category ?? existingMeta.category,
      content: input.content,
    });
    const links = extractWikiLinks(
      input.content,
      input.links ?? existingMeta.links,
      existingMeta.slug
    );
    const description = extractAutoDescription(
      input.description ?? existingMeta.description,
      title,
      type,
      input.content
    );
    const icon = resolveArtifactIconSvg({
      slug: existingMeta.slug,
      title,
      type,
      tags,
      icon: input.icon ?? existingMeta.icon,
      content: input.content,
    });

    const blob = await this.blobStore.putCasText(input.content);
    const contentChanged = String(existingRow.current_blob_sha256) !== blob.sha256;
    let nextVersion = existingMeta.currentVersion;

    if (contentChanged) {
      nextVersion = existingMeta.currentVersion + 1;
      const summary = input.summary || `Updated to v${nextVersion}`;
      this.db
        .prepare(
          `INSERT INTO artifact_versions (
            artifact_id, version, agent, summary, blob_sha256, byte_size, author_user_id, author_email, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          existingMeta.id,
          nextVersion,
          agent,
          summary,
          blob.sha256,
          blob.byteSize,
          ctx.user?.id || null,
          ctx.user?.email || '',
          now
        );
    }

    this.db
      .prepare(
        `UPDATE artifacts
         SET title = ?, description = ?, type = ?, language = ?, agent = ?, project_id = ?, project_slug = ?,
             category = ?, tags_json = ?, links_json = ?, icon = ?, current_version = ?, current_blob_sha256 = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        title,
        description,
        type,
        language,
        agent,
        String(projRow.id),
        String(projRow.slug),
        category,
        JSON.stringify(tags),
        JSON.stringify(links),
        icon,
        nextVersion,
        blob.sha256,
        now,
        existingMeta.id
      );

    this.updateFtsIndex(
      existingMeta.id,
      workspaceId,
      existingMeta.slug,
      title,
      description,
      category,
      tags,
      links,
      input.content
    );
    this.recordAudit({
      workspaceId,
      ctx,
      action: 'ARTIFACT_UPDATE',
      resourceType: 'artifact',
      resourceId: existingMeta.id,
      details: { slug: existingMeta.slug, version: nextVersion, contentChanged },
    });

    const updatedRow = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(existingMeta.id) as Record<string, unknown>;
    const detail = await this.hydrateArtifactDetail(updatedRow, existingRole || undefined);
    await this.publish({
      type: 'artifact:updated',
      workspaceId,
      artifactId: detail.id,
      artifact: detail,
      payload: { type: 'artifact:updated', artifact: detail },
    });
    return detail;
  }

  async upsertBySlug(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    slug: string,
    input: CreateArtifactInput
  ): Promise<ArtifactDetail> {
    const existing = this.findArtifactRow(workspaceId, slug);
    if (existing) {
      return this.updateArtifact(ctx, workspaceId, String(existing.id), {
        title: input.title,
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
    return this.createArtifact(ctx, workspaceId, { ...input, slug });
  }

  async rollbackArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    targetVersion: number
  ): Promise<ArtifactDetail> {
    const existingRow = this.findArtifactRow(workspaceId, idOrSlug);
    if (!existingRow) {
      throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    }
    const rank = this.resolveArtifactRank(ctx, workspaceId, existingRow);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:write', `artifact ${existingRow.slug}`);

    const verRow = this.db
      .prepare('SELECT blob_sha256 FROM artifact_versions WHERE artifact_id = ? AND version = ?')
      .get(String(existingRow.id), targetVersion) as { blob_sha256: string } | undefined;
    if (!verRow) {
      throw new CloudPermissionError(
        `Version ${targetVersion} not found for ${idOrSlug}`,
        404,
        'not_found'
      );
    }
    const historicalContent = await this.blobStore.getCasText(verRow.blob_sha256);
    if (historicalContent === null) {
      throw new CloudPermissionError('Version blob missing from object store', 404, 'not_found');
    }
    const inferred = inferTypeFromPathOrContent(undefined, historicalContent);
    return this.updateArtifact(ctx, workspaceId, String(existingRow.id), {
      content: historicalContent,
      type: inferred.type,
      language: inferred.language,
      agent: ctx.viaAgent,
      summary: `Rolled back to v${targetVersion}`,
    });
  }

  async getArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<ArtifactDetail | null> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return null;
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    const role = rankToRole(rank);
    evaluateAccess(role, ctx, 'artifact:read', `artifact ${row.slug}`);
    return this.hydrateArtifactDetail(row, role || undefined);
  }

  async getVersionContent(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    version: number
  ): Promise<string | null> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return null;
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:read', `artifact ${row.slug}`);
    const vRow = this.db
      .prepare('SELECT blob_sha256 FROM artifact_versions WHERE artifact_id = ? AND version = ?')
      .get(String(row.id), version) as { blob_sha256: string } | undefined;
    if (!vRow) return null;
    return this.blobStore.getCasText(vRow.blob_sha256);
  }

  private queryArtifactRows(
    workspaceId: string,
    filter: ListArtifactsFilter = {}
  ): Record<string, unknown>[] {
    const conditions: string[] = ['workspace_id = ?'];
    const params: (string | number)[] = [workspaceId];

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
          'id IN (SELECT artifact_id FROM artifacts_fts WHERE workspace_id = ? AND artifacts_fts MATCH ?)'
        );
        params.push(workspaceId, sanitized);
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

    const limit = clampQueryLimit(filter.limit, 200);
    const rows = this.db
      .prepare(
        `SELECT * FROM artifacts WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[];

    return rows.filter((row) => {
      if (filter.project && filter.project !== 'all') {
        const normProj =
          normalizeProjectName(filter.project) || filter.project.trim().toLowerCase();
        if (String(row.project_slug).toLowerCase() !== normProj) return false;
      }
      if (filter.category && filter.category !== 'all') {
        const normCat = normalizeWikiCategory(filter.category);
        const rowCat = String(row.category || '');
        if (rowCat !== normCat && !rowCat.startsWith(`${normCat}/`)) return false;
      }
      if (filter.tag) {
        try {
          const tags = JSON.parse(String(row.tags_json || '[]')) as string[];
          if (!tags.includes(filter.tag)) return false;
        } catch {
          return false;
        }
      }
      return true;
    });
  }

  async listArtifacts(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    filter: ListArtifactsFilter = {}
  ): Promise<ArtifactMetadata[]> {
    if (!ctx.scopes.includes('artifacts:read')) {
      throw new CloudPermissionError('Session lacks artifacts:read scope', 403, 'agent_scope_restricted');
    }
    const rows = this.queryArtifactRows(workspaceId, filter);
    const groupIds = ctx.user ? this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const results: ArtifactMetadata[] = [];

    for (const row of rows) {
      const rank = this.resolveArtifactRank(ctx, workspaceId, row, groupIds);
      const role = rankToRole(rank);
      if (role) {
        results.push(this.mapArtifactMetadata(row, role));
      }
    }
    return results;
  }

  async deleteArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<boolean> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return false;
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:delete', `artifact ${row.slug}`);

    const artifactId = String(row.id);
    this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(artifactId);
    this.db.prepare('DELETE FROM artifacts_fts WHERE artifact_id = ?').run(artifactId);
    this.db
      .prepare(
        "DELETE FROM role_bindings WHERE workspace_id = ? AND resource_type = 'artifact' AND resource_key = ?"
      )
      .run(workspaceId, artifactId);

    this.recordAudit({
      workspaceId,
      ctx,
      action: 'ARTIFACT_DELETE',
      resourceType: 'artifact',
      resourceId: artifactId,
      details: { slug: row.slug },
    });

    await this.publish({
      type: 'artifact:deleted',
      workspaceId,
      artifactId,
      payload: { type: 'artifact:deleted', id: idOrSlug, artifactId },
    });
    return true;
  }

  // KV Storage (window.storage)
  async getStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; value: string } | null> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:read', `artifact ${row.slug}`);

    const kv = this.db
      .prepare('SELECT key, value FROM artifact_kv_store WHERE artifact_id = ? AND key = ?')
      .get(String(row.id), key) as { key: string; value: string } | undefined;
    return kv ? { key: kv.key, value: kv.value } : null;
  }

  async setStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string,
    value: string
  ): Promise<{ key: string; value: string }> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'storage:write', `artifact ${row.slug} storage`);

    const artifactId = String(row.id);
    const strVal = String(value);
    const newByteSize = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(strVal, 'utf8');
    const totalRow = this.db
      .prepare(
        'SELECT COALESCE(SUM(byte_size), 0) as total FROM artifact_kv_store WHERE artifact_id = ? AND key != ?'
      )
      .get(artifactId, key) as { total: number };
    if (totalRow.total + newByteSize > MAX_STORAGE_BYTES) {
      throw new Error('Artifact storage limit exceeded (max 20 MB per artifact)');
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
      .run(artifactId, key, strVal, newByteSize, now);

    const entries = await this.getAllStorageEntries(ctx, workspaceId, artifactId);
    await this.publish({
      type: 'storage:updated',
      workspaceId,
      artifactId,
      payload: { type: 'storage:updated', artifactId, entries },
    });
    return { key, value: strVal };
  }

  async deleteStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; deleted: boolean }> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'storage:write', `artifact ${row.slug} storage`);

    const artifactId = String(row.id);
    const info = this.db
      .prepare('DELETE FROM artifact_kv_store WHERE artifact_id = ? AND key = ?')
      .run(artifactId, key);

    const entries = await this.getAllStorageEntries(ctx, workspaceId, artifactId);
    await this.publish({
      type: 'storage:updated',
      workspaceId,
      artifactId,
      payload: { type: 'storage:updated', artifactId, entries },
    });
    return { key, deleted: Number(info.changes) > 0 };
  }

  async listStorageKeys(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    prefix = ''
  ): Promise<{ keys: string[]; prefix: string }> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:read', `artifact ${row.slug}`);

    const safePrefix = typeof prefix === 'string' ? prefix : '';
    const escapedPrefix = escapeSqlLikePrefix(safePrefix);
    const rows = this.db
      .prepare(
        "SELECT key FROM artifact_kv_store WHERE artifact_id = ? AND key LIKE ? ESCAPE '\\' ORDER BY key ASC"
      )
      .all(String(row.id), `${escapedPrefix}%`) as Array<{ key: string }>;
    return { keys: rows.map((r) => r.key), prefix: safePrefix };
  }

  async getAllStorageEntries(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<StorageEntry[]> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return [];
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:read', `artifact ${row.slug}`);

    const rows = this.db
      .prepare(
        'SELECT key, value, updated_at FROM artifact_kv_store WHERE artifact_id = ? ORDER BY key ASC'
      )
      .all(String(row.id)) as Array<{ key: string; value: string; updated_at: string }>;
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  }

  async clearStorage(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<void> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return;
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'storage:write', `artifact ${row.slug} storage`);

    const artifactId = String(row.id);
    this.db.prepare('DELETE FROM artifact_kv_store WHERE artifact_id = ?').run(artifactId);
    await this.publish({
      type: 'storage:updated',
      workspaceId,
      artifactId,
      payload: { type: 'storage:updated', artifactId, entries: [] },
    });
  }

  async getWikiData(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectFilter?: string
  ): Promise<WikiTaxonomy & { indexMarkdown: string; logMarkdown: string }> {
    const items = await this.listArtifacts(ctx, workspaceId, {
      project: projectFilter,
      limit: 1000,
    });
    const visibleIds = new Set(items.map((i) => i.id));
    const visibleSlugs = new Set(items.map((i) => i.slug));

    const byProject = new Map<string, Map<string, ArtifactMetadata[]>>();
    const catMap = new Map<string, string[]>();
    const backlinks: Record<string, string[]> = {};

    for (const item of items) {
      const proj = item.project || 'general';
      const cat = item.category || 'concepts/general';
      if (!byProject.has(proj)) byProject.set(proj, new Map());
      const pCats = byProject.get(proj)!;
      if (!pCats.has(cat)) pCats.set(cat, []);
      pCats.get(cat)!.push(item);

      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(item.slug);

      for (const target of item.links || []) {
        if (!visibleSlugs.has(target)) continue; // Do not leak hidden artifact backlinks
        if (!backlinks[target]) backlinks[target] = [];
        if (!backlinks[target].includes(item.slug)) {
          backlinks[target].push(item.slug);
        }
      }
    }

    const sortedProjects = Array.from(byProject.keys()).sort((a, b) => a.localeCompare(b));
    const projects: WikiTaxonomy['projects'] = [];
    const lines: string[] = [
      '# MyArtifact Cloud LLM Wiki — Master Index (`index.md`)',
      '',
      `**Accessible Artifacts:** ${items.length} across **${sortedProjects.length} projects** · **Synced:** ${new Date().toISOString()}`,
      '',
    ];

    for (const proj of sortedProjects) {
      const pRow = this.resolveProjectRow(workspaceId, proj);
      const pCats = byProject.get(proj)!;
      const cats = Array.from(pCats.keys())
        .sort()
        .map((category) => {
          const list = pCats.get(category)!;
          return { category, count: list.length, slugs: list.map((a) => a.slug) };
        });
      const count = cats.reduce((sum, c) => sum + c.count, 0);
      projects.push({
        project: proj,
        count,
        inheritWorkspaceAcl: pRow ? Number(pRow.inherit_workspace_acl) === 1 : true,
        categories: cats,
      });

      lines.push(`## Project: \`${proj}\` (${count})`);
      for (const c of cats) {
        lines.push(`### \`${proj}\` / \`${c.category}\``);
        for (const item of pCats.get(c.category)!) {
          lines.push(
            `- **[[${item.slug}]]** — ${item.title} (\`${item.type}\` · \`v${item.currentVersion}\` · ${item.description})`
          );
        }
        lines.push('');
      }
    }

    const categories = Array.from(catMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, slugs]) => ({ category, count: slugs.length, slugs }));

    const auditRows = this.db
      .prepare(
        "SELECT * FROM audit_events WHERE workspace_id = ? AND resource_type = 'artifact' ORDER BY created_at DESC LIMIT 80"
      )
      .all(workspaceId) as Record<string, unknown>[];

    const logLines = ['# MyArtifact Cloud LLM Wiki — Operation Log (`log.md`)', ''];
    for (const ev of auditRows) {
      if (!visibleIds.has(String(ev.resource_id))) continue;
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(String(ev.details_json || '{}'));
      } catch {
        details = {};
      }
      logLines.push(
        `- **[${String(ev.created_at)}]** \`${String(ev.action)}\` | \`${String(ev.actor_email || 'user')}\` via \`${String(ev.via_agent)}\` → **[[${String(details.slug || ev.resource_id)}]]**`
      );
    }

    return {
      projects,
      categories,
      backlinks,
      indexMarkdown: lines.join('\n'),
      logMarkdown: logLines.join('\n'),
    };
  }

  private async ensureRunArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: {
      slug: string;
      title?: string;
      experiment?: string;
      modelName?: string;
      framework?: string;
      status?: 'running' | 'completed' | 'failed';
      hparams?: Record<string, string | number | boolean>;
      agent?: string;
      project?: string;
    }
  ): Promise<{ artifact: ArtifactDetail; manifest: TensorBoardRunManifest }> {
    const cleanSlug = slugify(input.slug);
    const existingRow = this.findArtifactRow(workspaceId, cleanSlug);

    let baseManifest: TensorBoardRunManifest = {
      runSlug: cleanSlug,
      title:
        input.title || cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      experiment: input.experiment || 'default-experiment',
      modelName: input.modelName || cleanSlug,
      framework: input.framework || 'pytorch',
      status: input.status || 'running',
      hparams: input.hparams || {},
      scalars: {},
      checkpoints: [],
      logDir: `cloud://${workspaceId}/runs/${cleanSlug}`,
      updatedAt: new Date().toISOString(),
    };

    if (existingRow) {
      const rank = this.resolveArtifactRank(ctx, workspaceId, existingRow);
      const role = rankToRole(rank);
      evaluateAccess(role, ctx, 'tb:write', `run ${cleanSlug}`);
      const detail = await this.hydrateArtifactDetail(existingRow, role || undefined);
      try {
        const parsed = JSON.parse(detail.content) as Partial<TensorBoardRunManifest>;
        baseManifest = {
          ...baseManifest,
          ...parsed,
          title: input.title || parsed.title || detail.title,
          experiment: input.experiment || parsed.experiment || baseManifest.experiment,
          modelName: input.modelName || parsed.modelName || baseManifest.modelName,
          framework: input.framework || parsed.framework || baseManifest.framework,
          status: input.status || parsed.status || baseManifest.status,
          hparams: { ...(parsed.hparams || {}), ...(input.hparams || {}) },
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Keep baseManifest
      }
      return { artifact: detail, manifest: baseManifest };
    }

    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    if (!ctx.scopes.includes('tb:write')) {
      throw new CloudPermissionError(
        `Active session (${ctx.sessionKind || 'delegated'}) lacks scope "tb:write". Run "myartifact login --elevate" or use the Web Studio.`,
        403,
        'agent_scope_restricted'
      );
    }

    const created = await this.createArtifact(ctx, workspaceId, {
      slug: cleanSlug,
      title: baseManifest.title,
      description: `TensorBoard training run (${baseManifest.framework}) · ${baseManifest.modelName}`,
      type: 'tensorboard',
      language: 'tensorboard',
      agent: input.agent || ctx.viaAgent,
      project: input.project || baseManifest.experiment,
      tags: ['tensorboard', 'training', baseManifest.framework],
      summary: 'Initialized TensorBoard training run (v1)',
      content: JSON.stringify(baseManifest, null, 2),
    });
    return { artifact: created, manifest: baseManifest };
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

    const ckptRows = this.db
      .prepare(
        'SELECT * FROM tb_checkpoints WHERE artifact_id = ? ORDER BY step DESC, created_at DESC'
      )
      .all(artifactId) as Record<string, unknown>[];

    return {
      ...base,
      scalars,
      checkpoints: ckptRows.map((r) => this.mapCheckpointRow(r)),
      updatedAt: new Date().toISOString(),
    };
  }

  private mapCheckpointRow(row: Record<string, unknown>): ModelCheckpoint {
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
      ...(row.epoch !== null && row.epoch !== undefined ? { epoch: Number(row.epoch) } : {}),
      filePath: String(row.object_key),
      format: String(row.format || 'safetensors'),
      byteSize: Number(row.byte_size || 0),
      sha256: String(row.sha256 || ''),
      metrics,
      metadata,
      isBest: Number(row.is_best) === 1,
      createdAt: String(row.created_at),
    };
  }

  async logTensorBoardScalars(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: LogScalarsInput
  ): Promise<ArtifactDetail> {
    const { artifact, manifest } = await this.ensureRunArtifact(ctx, workspaceId, input);
    const nowSec = input.wallTime ?? Date.now() / 1000;
    const points: TensorBoardScalarPoint[] = [...(input.scalars || [])];

    if (input.metrics) {
      const step = input.step ?? 0;
      for (const [tag, value] of Object.entries(input.metrics)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          points.push({ tag, step, epoch: input.epoch, value, wallTime: nowSec });
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
    for (const pt of points) {
      insertStmt.run(
        artifact.id,
        pt.tag,
        pt.step,
        pt.epoch ?? null,
        pt.value,
        pt.wallTime || nowSec
      );
    }

    const fullManifest = this.buildSyncedRunManifest(artifact.id, manifest);
    return this.updateArtifact(ctx, workspaceId, artifact.id, {
      title: fullManifest.title,
      content: JSON.stringify(fullManifest, null, 2),
      agent: input.agent || ctx.viaAgent,
      summary: input.summary || `Logged ${points.length} scalar point(s)`,
    });
  }

  async saveModelCheckpoint(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: SaveModelCheckpointInput
  ): Promise<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }> {
    const { artifact, manifest } = await this.ensureRunArtifact(ctx, workspaceId, {
      slug: input.slug,
      title: input.title,
      agent: input.agent,
    });
    const step = input.step ?? 0;
    const format = (input.format || 'safetensors').toLowerCase();
    const safeFileName = (input.name || `checkpoint-step-${step}.${format}`).replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    const id = crypto.randomUUID();
    const objectKey = `workspaces/${workspaceId}/runs/${manifest.runSlug}/checkpoints/${id}/${safeFileName}`;
    const payload =
      input.content !== undefined
        ? Buffer.isBuffer(input.content)
          ? input.content
          : Buffer.from(String(input.content), 'utf8')
        : Buffer.from(
            JSON.stringify({
              runSlug: manifest.runSlug,
              name: safeFileName,
              step,
              epoch: input.epoch,
              metrics: input.metrics || {},
              metadata: input.metadata || {},
            }),
            'utf8'
          );

    const putRes = await this.blobStore.putObject(objectKey, payload);
    return this.finalizeCheckpointWithMeta(ctx, workspaceId, artifact, manifest, {
      checkpointId: id,
      objectKey,
      name: safeFileName,
      step,
      epoch: input.epoch,
      format,
      byteSize: putRes.byteSize,
      sha256: putRes.sha256,
      metrics: input.metrics,
      metadata: input.metadata,
      isBest: input.isBest,
      agent: input.agent,
      summary: input.summary,
    });
  }

  private async finalizeCheckpointWithMeta(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    artifact: ArtifactDetail,
    manifest: TensorBoardRunManifest,
    params: {
      checkpointId: string;
      objectKey: string;
      name: string;
      step: number;
      epoch?: number;
      format: string;
      byteSize: number;
      sha256: string;
      metrics?: Record<string, number>;
      metadata?: Record<string, unknown>;
      isBest?: boolean;
      agent?: string;
      summary?: string;
    }
  ): Promise<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }> {
    const now = new Date().toISOString();
    const isBest = Boolean(params.isBest);
    if (isBest) {
      this.db
        .prepare('UPDATE tb_checkpoints SET is_best = 0 WHERE artifact_id = ?')
        .run(artifact.id);
    }

    this.db
      .prepare(
        `INSERT INTO tb_checkpoints (
          id, artifact_id, run_slug, name, step, epoch, object_key, format, byte_size, sha256, metrics_json, metadata_json, is_best, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.checkpointId,
        artifact.id,
        manifest.runSlug,
        params.name,
        params.step,
        params.epoch ?? null,
        params.objectKey,
        params.format,
        params.byteSize,
        params.sha256,
        JSON.stringify(params.metrics || {}),
        JSON.stringify(params.metadata || {}),
        isBest ? 1 : 0,
        now
      );

    const fullManifest = this.buildSyncedRunManifest(artifact.id, manifest);
    const updatedArtifact = await this.updateArtifact(ctx, workspaceId, artifact.id, {
      content: JSON.stringify(fullManifest, null, 2),
      agent: params.agent || ctx.viaAgent,
      summary:
        params.summary ||
        `Saved ${isBest ? 'best ' : ''}model checkpoint ${params.name} (step ${params.step})`,
    });

    const row = this.db
      .prepare('SELECT * FROM tb_checkpoints WHERE id = ?')
      .get(params.checkpointId) as Record<string, unknown>;
    return { artifact: updatedArtifact, checkpoint: this.mapCheckpointRow(row) };
  }

  async presignCheckpointUpload(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    runSlug: string,
    input: { name: string; contentType?: string }
  ) {
    const cleanSlug = slugify(runSlug);
    const existing = this.findArtifactRow(workspaceId, cleanSlug);
    if (existing) {
      const rank = this.resolveArtifactRank(ctx, workspaceId, existing);
      evaluateAccess(rankToRole(rank), ctx, 'tb:write', `run ${cleanSlug}`);
    } else {
      const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
      evaluateAccess(wsRole, ctx, 'tb:write', `workspace ${workspaceId}`);
    }

    const checkpointId = crypto.randomUUID();
    const safeName = (input.name || 'checkpoint.safetensors').replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `workspaces/${workspaceId}/runs/${cleanSlug}/checkpoints/${checkpointId}/${safeName}`;
    const transfer = await this.blobStore.createPresignedUpload(
      objectKey,
      900,
      input.contentType || 'application/octet-stream'
    );
    return {
      checkpointId,
      objectKey,
      uploadUrl: transfer.url,
      method: 'PUT' as const,
      headers: transfer.headers,
      expiresAt: transfer.expiresAt,
    };
  }

  async finalizeCheckpointUpload(
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
  ): Promise<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }> {
    const cleanSlug = slugify(runSlug);
    const existing = this.findArtifactRow(workspaceId, cleanSlug);
    if (existing) {
      const rank = this.resolveArtifactRank(ctx, workspaceId, existing);
      evaluateAccess(rankToRole(rank), ctx, 'tb:write', `run ${cleanSlug}`);
    } else {
      const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
      evaluateAccess(wsRole, ctx, 'tb:write', `workspace ${workspaceId}`);
    }

    assertValidCheckpointFinalizeInput(workspaceId, cleanSlug, input.checkpointId, input.objectKey);

    const buf = await this.blobStore.getObjectBuffer(input.objectKey);
    if (!buf) {
      throw new CloudPermissionError('Uploaded checkpoint object not found in blob store', 404, 'not_found');
    }
    const { artifact, manifest } = await this.ensureRunArtifact(ctx, workspaceId, {
      slug: cleanSlug,
      agent: input.agent,
    });
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const format = (input.format || path.extname(input.name).replace(/^\./, '') || 'safetensors').toLowerCase();
    return this.finalizeCheckpointWithMeta(ctx, workspaceId, artifact, manifest, {
      checkpointId: input.checkpointId,
      objectKey: input.objectKey,
      name: input.name,
      step: input.step ?? 0,
      epoch: input.epoch,
      format,
      byteSize: buf.byteLength,
      sha256,
      metrics: input.metrics,
      metadata: input.metadata,
      isBest: input.isBest,
      agent: input.agent,
      summary: input.summary,
    });
  }

  async getModelCheckpoints(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<ModelCheckpoint[]> {
    const row = this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return [];
    const rank = this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:read', `run ${row.slug}`);

    const ckptRows = this.db
      .prepare(
        'SELECT * FROM tb_checkpoints WHERE artifact_id = ? ORDER BY step DESC, created_at DESC'
      )
      .all(String(row.id)) as Record<string, unknown>[];
    return ckptRows.map((r) => this.mapCheckpointRow(r));
  }

  async getCheckpointDownloadUrl(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    checkpointId: string
  ): Promise<{ checkpoint: ModelCheckpoint; url: string } | null> {
    const row = this.db
      .prepare('SELECT * FROM tb_checkpoints WHERE id = ?')
      .get(checkpointId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const artRow = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ? AND workspace_id = ?')
      .get(String(row.artifact_id), workspaceId) as Record<string, unknown> | undefined;
    if (!artRow) return null;

    const rank = this.resolveArtifactRank(ctx, workspaceId, artRow);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:read', `checkpoint ${row.name}`);

    const checkpoint = this.mapCheckpointRow(row);
    const transfer = await this.blobStore.createPresignedDownload(
      checkpoint.filePath,
      checkpoint.name,
      900
    );
    return { checkpoint, url: transfer.url };
  }

  public parseTfEvents(buf: Buffer): TensorBoardScalarPoint[] {
    return parseTfEventsBuffer(buf);
  }

  async listAuditEvents(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    limit = 100
  ): Promise<AuditEvent[]> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId} audit`);
    const clampedLimit = clampQueryLimit(limit, 100);
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(workspaceId, clampedLimit) as Record<string, unknown>[];
    return rows.map((r) => {
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(String(r.details_json || '{}'));
      } catch {
        details = {};
      }
      return {
        id: String(r.id),
        ...(r.workspace_id ? { workspaceId: String(r.workspace_id) } : {}),
        ...(r.actor_user_id ? { actorUserId: String(r.actor_user_id) } : {}),
        actorEmail: String(r.actor_email || ''),
        viaAgent: String(r.via_agent || 'web'),
        ...(r.auth_session_id ? { authSessionId: String(r.auth_session_id) } : {}),
        action: String(r.action),
        resourceType: String(r.resource_type),
        resourceId: String(r.resource_id),
        details,
        createdAt: String(r.created_at),
      };
    });
  }

  async getWorkspaceSyncState(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    selectedArtifactIdOrSlug?: string
  ): Promise<WorkspaceSyncState> {
    if (!ctx.authenticated && !ctx.shareLink) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    const visible = await this.listArtifacts(ctx, workspaceId, { limit: 500 });
    const listSig = visible
      .map(
        (a) =>
          `${a.id}:${a.currentVersion}:${a.updatedAt}:${a.effectiveRole || ''}:${a.project}:${a.category}`
      )
      .join('|');

    let artifactRevision: string | undefined;
    let storageRevision: string | undefined;

    if (selectedArtifactIdOrSlug) {
      const targetLower = selectedArtifactIdOrSlug.toLowerCase();
      let art: ArtifactMetadata | undefined = visible.find(
        (a) => a.id === selectedArtifactIdOrSlug || a.slug.toLowerCase() === targetLower
      );
      if (!art) {
        const resolved = await this.resolveArtifactRole(ctx, workspaceId, selectedArtifactIdOrSlug);
        if (resolved && resolved.role) {
          art = resolved.artifact;
        }
      }
      if (art) {
        artifactRevision = sha256Hex(
          `${art.id}:${art.currentVersion}:${art.updatedAt}:${art.effectiveRole || ''}`
        ).slice(0, 16);
        const kvRow = this.db
          .prepare(
            "SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), '') AS max_upd FROM artifact_kv_store WHERE artifact_id = ?"
          )
          .get(art.id) as { cnt?: number; max_upd?: string } | undefined;
        storageRevision = sha256Hex(
          `${art.id}:${Number(kvRow?.cnt || 0)}:${String(kvRow?.max_upd || '')}`
        ).slice(0, 16);
      }
    }

    const revision = sha256Hex(
      `${workspaceId}|${listSig}|${artifactRevision || ''}|${storageRevision || ''}`
    ).slice(0, 20);

    return {
      workspaceId,
      revision,
      ...(artifactRevision ? { artifactRevision } : {}),
      ...(storageRevision ? { storageRevision } : {}),
      serverTime: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
