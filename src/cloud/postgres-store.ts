import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
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
import { PostgresBlobStore, type BlobStore } from './blob-store.js';
import { sha256Hex } from './auth/jwt.js';
import { CLOUD_SCHEMA_SQL } from './migrations/schema-sql.js';
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
  isValidUuid,
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

interface PgQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

interface PgClientLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PgQueryResult<T>>;
  release(): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

interface PgPoolLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PgQueryResult<T>>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

const MAX_STORAGE_BYTES = 20 * 1024 * 1024;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveMigrationSql(): string {
  const candidates = [
    path.resolve(__dirname, './migrations/001_cloud_schema.sql'),
    path.resolve(__dirname, '../src/cloud/migrations/001_cloud_schema.sql'),
    path.resolve(process.cwd(), 'src/cloud/migrations/001_cloud_schema.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  return CLOUD_SCHEMA_SQL;
}

export class PostgresCloudStore implements CloudStore {
  public readonly blobStore: BlobStore;
  private readonly emitter = new EventEmitter();
  private listenClient: PgClientLike | null = null;
  private readonly enableListenNotify: boolean;

  private constructor(
    private readonly pool: PgPoolLike,
    blobStore: BlobStore,
    enableListenNotify = false
  ) {
    this.blobStore = blobStore;
    this.enableListenNotify = enableListenNotify;
  }

  public static async connect(
    connectionString: string,
    blobStore?: BlobStore,
    options: { enableListenNotify?: boolean; maxPoolSize?: number } = {}
  ): Promise<PostgresCloudStore> {
    let pgMod: {
      Pool?: new (opts: Record<string, unknown>) => PgPoolLike;
      default?: { Pool?: new (opts: Record<string, unknown>) => PgPoolLike };
    };
    try {
      pgMod = (await import('pg')) as unknown as {
        Pool?: new (opts: Record<string, unknown>) => PgPoolLike;
        default?: { Pool?: new (opts: Record<string, unknown>) => PgPoolLike };
      };
    } catch {
      throw new Error(
        'PostgreSQL driver "pg" is not installed. Run "npm install pg" or omit DATABASE_URL to use single-node SQLite cloud mode.'
      );
    }

    const PoolCtor = pgMod.Pool || pgMod.default?.Pool;
    if (!PoolCtor) {
      throw new Error('PostgreSQL driver "pg" did not expose Pool constructor.');
    }

    const pool = new PoolCtor({
      connectionString,
      max: options.maxPoolSize ?? Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    const effectiveBlobStore = blobStore || new PostgresBlobStore(pool);
    const enableListenNotify =
      options.enableListenNotify ??
      (process.env.MYARTIFACT_ENABLE_WS === 'true' && !process.env.VERCEL);

    const store = new PostgresCloudStore(pool, effectiveBlobStore, enableListenNotify);
    await store.migrate();
    if (enableListenNotify) {
      await store.startPubSubListener();
    }
    return store;
  }

  private async migrate(): Promise<void> {
    const chk = await this.pool.query<{ reg: string | null }>(
      "SELECT to_regclass('public.cloud_blobs')::text AS reg"
    );
    if (chk.rows[0]?.reg) return;
    const sql = resolveMigrationSql();
    await this.pool.query(sql);
  }

  private async startPubSubListener(): Promise<void> {
    try {
      const client = await this.pool.connect();
      this.listenClient = client;
      client.on?.('notification', (msg: unknown) => {
        const payloadStr =
          msg && typeof msg === 'object' && 'payload' in msg
            ? String((msg as { payload?: string }).payload || '')
            : '';
        if (!payloadStr) return;
        try {
          const event = JSON.parse(payloadStr) as CloudPubSubEvent;
          this.emitter.emit('event', event);
        } catch {
          // Ignore malformed notification
        }
      });
      await client.query('LISTEN myartifact_events');
    } catch {
      // Non-fatal in single-node or restricted environments
    }
  }

  public subscribe(listener: (event: CloudPubSubEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  public async publish(event: CloudPubSubEvent): Promise<void> {
    this.emitter.emit('event', event);
    if (!this.enableListenNotify) return;
    try {
      const serialized = JSON.stringify(event);
      if (Buffer.byteLength(serialized, 'utf8') < 7500) {
        await this.pool.query('SELECT pg_notify($1, $2)', ['myartifact_events', serialized]);
      } else {
        const compact = JSON.stringify({
          type: event.type,
          workspaceId: event.workspaceId,
          artifactId: event.artifactId,
          payload: { type: event.type, artifactId: event.artifactId },
        });
        await this.pool.query('SELECT pg_notify($1, $2)', ['myartifact_events', compact]);
      }
    } catch {
      // Best-effort cross-replica fanout
    }
  }

  private async withTx<T>(fn: (client: PgClientLike) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private iso(val: unknown): string {
    if (val instanceof Date) return val.toISOString();
    return val ? String(val) : new Date().toISOString();
  }

  private mapUser(row: Record<string, unknown>): UserProfile {
    return {
      id: String(row.id),
      googleSub: String(row.google_sub),
      email: String(row.email),
      emailVerified: Boolean(row.email_verified),
      ...(row.google_hd ? { googleHd: String(row.google_hd) } : {}),
      displayName: String(row.display_name),
      ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private mapWorkspace(row: Record<string, unknown>, effectiveRole?: Role): Workspace {
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      isPersonal: Boolean(row.is_personal),
      ...(row.allowed_google_hd ? { allowedGoogleHd: String(row.allowed_google_hd) } : {}),
      createdBy: String(row.created_by),
      ...(effectiveRole ? { effectiveRole } : {}),
      createdAt: this.iso(row.created_at),
    };
  }

  private mapSession(row: Record<string, unknown>): AuthSessionInfo {
    const scopeCeiling = Array.isArray(row.scope_ceiling)
      ? (row.scope_ceiling as AgentScope[])
      : [];
    return {
      id: String(row.id),
      userId: String(row.user_id),
      sessionKind: String(row.session_kind) as AuthSessionKind,
      scopeCeiling,
      ...(row.default_workspace_id
        ? { defaultWorkspaceId: String(row.default_workspace_id) }
        : {}),
      ...(row.device_label ? { deviceLabel: String(row.device_label) } : {}),
      createdAt: this.iso(row.created_at),
      lastUsedAt: this.iso(row.last_used_at),
      expiresAt: this.iso(row.expires_at),
      ...(row.revoked_at ? { revokedAt: this.iso(row.revoked_at) } : {}),
    };
  }

  private async mapBinding(row: Record<string, unknown>): Promise<RoleBinding> {
    const rank = Number(row.role_rank);
    const principalType = String(row.principal_type) as PrincipalType;
    const principalKey = String(row.principal_key);
    let principalLabel = principalKey;
    if (principalType === 'user') {
      const u = await this.pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
        principalKey,
      ]);
      if (u.rows[0]?.email) principalLabel = u.rows[0].email;
    } else if (principalType === 'group') {
      const g = await this.pool.query<{ name: string; slug: string }>(
        'SELECT name, slug FROM groups WHERE id = $1',
        [principalKey]
      );
      if (g.rows[0]?.slug) principalLabel = `@${g.rows[0].slug} (${g.rows[0].name})`;
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
      ...(row.expires_at ? { expiresAt: this.iso(row.expires_at) } : {}),
      createdAt: this.iso(row.created_at),
    };
  }

  private mapShareLink(row: Record<string, unknown>): ShareLink {
    const spec = (row.target_spec_json || { kind: 'artifact', artifactIds: [] }) as ShareLinkTargetSpec;
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      tokenPrefix: String(row.token_prefix),
      accessMode: String(row.access_mode) as 'anyone' | 'domain',
      ...(row.required_hd ? { requiredHd: String(row.required_hd) } : {}),
      role: Number(row.role_rank) >= 20 ? 'editor' : 'viewer',
      targetSpec: spec,
      ...(row.label ? { label: String(row.label) } : {}),
      createdBy: String(row.created_by),
      ...(row.expires_at ? { expiresAt: this.iso(row.expires_at) } : {}),
      ...(row.revoked_at ? { revokedAt: this.iso(row.revoked_at) } : {}),
      createdAt: this.iso(row.created_at),
    };
  }

  private async recordAudit(
    q: { query: PgPoolLike['query'] },
    input: {
      workspaceId?: string;
      ctx?: AuthPrincipalContext;
      actorUserId?: string;
      actorEmail?: string;
      viaAgent?: string;
      action: string;
      resourceType: string;
      resourceId: string;
      details?: Record<string, unknown>;
    }
  ): Promise<void> {
    await q.query(
      `INSERT INTO audit_events (id, workspace_id, actor_user_id, actor_email, via_agent, auth_session_id, action, resource_type, resource_id, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        crypto.randomUUID(),
        input.workspaceId || null,
        input.actorUserId || input.ctx?.user?.id || null,
        input.actorEmail || input.ctx?.user?.email || '',
        input.viaAgent || input.ctx?.viaAgent || 'web',
        input.ctx?.sessionId || null,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.details || {}),
      ]
    );
  }

  private async uniqueWorkspaceSlug(q: PgClientLike, baseRaw: string): Promise<string> {
    const base = slugify(baseRaw).slice(0, 48) || 'workspace';
    let candidate = base;
    let c = 2;
    while ((await q.query('SELECT 1 FROM workspaces WHERE slug = $1', [candidate])).rows.length > 0) {
      candidate = `${base}-${c++}`;
    }
    return candidate;
  }

  private async uniqueArtifactSlug(workspaceId: string, baseRaw: string): Promise<string> {
    const base = slugify(baseRaw);
    let candidate = base;
    let c = 2;
    while (
      (
        await this.pool.query(
          'SELECT 1 FROM artifacts WHERE workspace_id = $1 AND slug = $2',
          [workspaceId, candidate]
        )
      ).rows.length > 0
    ) {
      candidate = `${base}-${c++}`;
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
    const hd = input.googleHd ? input.googleHd.trim().toLowerCase() : null;

    return this.withTx(async (tx) => {
      const existing = await tx.query(
        'SELECT * FROM users WHERE google_sub = $1 OR email = $2',
        [input.googleSub, email]
      );
      let userId: string;
      if (existing.rows[0]) {
        userId = String(existing.rows[0].id);
        await tx.query(
          `UPDATE users SET google_sub = $1, email = $2, email_verified = TRUE, google_hd = $3, display_name = $4, avatar_url = $5, updated_at = NOW()
           WHERE id = $6`,
          [input.googleSub, email, hd, input.displayName || email, input.avatarUrl || null, userId]
        );
      } else {
        userId = crypto.randomUUID();
        await tx.query(
          `INSERT INTO users (id, google_sub, email, email_verified, google_hd, display_name, avatar_url)
           VALUES ($1, $2, $3, TRUE, $4, $5, $6)`,
          [userId, input.googleSub, email, hd, input.displayName || email, input.avatarUrl || null]
        );
      }

      const userRes = await tx.query('SELECT * FROM users WHERE id = $1', [userId]);
      const user = this.mapUser(userRes.rows[0]);

      // Convert any group_members matching email -> user_id
      let wsRes = await tx.query(
        'SELECT * FROM workspaces WHERE created_by = $1 AND is_personal = TRUE',
        [userId]
      );
      if (!wsRes.rows[0]) {
        const wsId = crypto.randomUUID();
        const handle = email.split('@')[0] || 'personal';
        const wsSlug = await this.uniqueWorkspaceSlug(tx, handle);
        await tx.query(
          `INSERT INTO workspaces (id, slug, name, is_personal, allowed_google_hd, created_by)
           VALUES ($1, $2, $3, TRUE, NULL, $4)`,
          [wsId, wsSlug, `${input.displayName || handle}'s Workspace`, userId]
        );
        await tx.query(
          `INSERT INTO role_bindings (id, workspace_id, principal_type, principal_key, resource_type, resource_key, role_rank, granted_by)
           VALUES ($1, $2, 'user', $3, 'workspace', $4, 40, $5)`,
          [crypto.randomUUID(), wsId, userId, wsId, userId]
        );
        wsRes = await tx.query('SELECT * FROM workspaces WHERE id = $1', [wsId]);
      }

      // Claim pending_email batch invites
      const pending = await tx.query(
        "SELECT * FROM role_bindings WHERE principal_type = 'pending_email' AND LOWER(principal_key) = $1",
        [email]
      );
      let claimedInvites = 0;
      for (const p of pending.rows) {
        const existingB = await tx.query<{ id: string; role_rank: number }>(
          `SELECT id, role_rank FROM role_bindings
           WHERE workspace_id = $1 AND principal_type = 'user' AND principal_key = $2
             AND resource_type = $3 AND resource_key = $4`,
          [p.workspace_id, userId, p.resource_type, p.resource_key]
        );
        if (existingB.rows[0]) {
          if (Number(p.role_rank) > Number(existingB.rows[0].role_rank)) {
            await tx.query('UPDATE role_bindings SET role_rank = $1 WHERE id = $2', [
              p.role_rank,
              existingB.rows[0].id,
            ]);
          }
          await tx.query('DELETE FROM role_bindings WHERE id = $1', [p.id]);
        } else {
          await tx.query(
            "UPDATE role_bindings SET principal_type = 'user', principal_key = $1 WHERE id = $2",
            [userId, p.id]
          );
        }
        claimedInvites++;
      }

      if (claimedInvites > 0) {
        await this.recordAudit(tx, {
          actorUserId: userId,
          actorEmail: email,
          viaAgent: 'web',
          action: 'INVITE_CLAIMED',
          resourceType: 'user',
          resourceId: userId,
          details: { claimedInvites },
        });
      }

      return {
        user,
        personalWorkspace: this.mapWorkspace(wsRes.rows[0], 'owner'),
        claimedInvites,
      };
    });
  }

  async getUserById(userId: string): Promise<UserProfile | null> {
    const r = await this.pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const r = await this.pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }

  async createAuthSession(input: CreateSessionInput): Promise<AuthSessionInfo> {
    const id = crypto.randomUUID();
    const res = await this.pool.query(
      `INSERT INTO auth_sessions (
        id, user_id, session_kind, refresh_token_hash, scope_ceiling, default_workspace_id, device_label, expires_at
      ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8)
      RETURNING *`,
      [
        id,
        input.userId,
        input.sessionKind,
        input.refreshTokenHash,
        input.scopeCeiling,
        input.defaultWorkspaceId || null,
        input.deviceLabel || '',
        input.expiresAt,
      ]
    );
    return this.mapSession(res.rows[0]);
  }

  async getAuthSession(sessionId: string): Promise<AuthSessionInfo | null> {
    const res = await this.pool.query('SELECT * FROM auth_sessions WHERE id = $1', [sessionId]);
    return res.rows[0] ? this.mapSession(res.rows[0]) : null;
  }

  async listUserSessions(userId: string): Promise<AuthSessionInfo[]> {
    const res = await this.pool.query(
      'SELECT * FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return res.rows.map((r) => this.mapSession(r));
  }

  async rotateRefreshToken(input: RotateRefreshInput): Promise<RotateRefreshResult> {
    const graceMs = input.graceWindowMs ?? 30_000;
    const nowMs = Date.now();
    const graceUntil = new Date(nowMs + graceMs).toISOString();

    const outcome = await this.withTx(async (tx) => {
      const res = await tx.query(
        `SELECT * FROM auth_sessions
         WHERE refresh_token_hash = $1 OR prev_refresh_token_hash = $1
         FOR UPDATE`,
        [input.presentedTokenHash]
      );
      const row = res.rows[0];
      if (!row) {
        throw new CloudPermissionError('Invalid refresh token', 401, 'unauthenticated');
      }
      if (row.revoked_at) {
        throw new CloudPermissionError('Session has been revoked', 401, 'unauthenticated');
      }
      if (Date.parse(this.iso(row.expires_at)) <= nowMs) {
        throw new CloudPermissionError('Refresh token has expired', 401, 'unauthenticated');
      }

      const sessionId = String(row.id);
      const userId = String(row.user_id);
      let usedGraceWindow = false;

      if (String(row.prev_refresh_token_hash || '') === input.presentedTokenHash) {
        const graceUntilMs = row.prev_grace_until ? Date.parse(this.iso(row.prev_grace_until)) : 0;
        if (!graceUntilMs || nowMs > graceUntilMs) {
          await tx.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);
          await this.recordAudit(tx, {
            actorUserId: userId,
            viaAgent: 'auth',
            action: 'SESSION_REPLAY_DETECTED',
            resourceType: 'auth_session',
            resourceId: sessionId,
          });
          return { replayDetected: true as const };
        }
        usedGraceWindow = true;
      }

      const nextExpiresAt = capSessionExpiresAt(
        String(row.session_kind),
        this.iso(row.created_at),
        input.nextExpiresAt,
        nowMs
      );
      const upd = await tx.query(
        `UPDATE auth_sessions
         SET prev_refresh_token_hash = refresh_token_hash,
             refresh_token_hash = $1,
             prev_grace_until = $2,
             last_used_at = NOW(),
             expires_at = $3
         WHERE id = $4
         RETURNING *`,
        [input.nextRefreshTokenHash, graceUntil, nextExpiresAt, sessionId]
      );
      const uRes = await tx.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (!uRes.rows[0]) {
        throw new CloudPermissionError('User not found', 401, 'unauthenticated');
      }
      return {
        replayDetected: false as const,
        result: {
          session: this.mapSession(upd.rows[0]),
          user: this.mapUser(uRes.rows[0]),
          usedGraceWindow,
        },
      };
    });

    if (outcome.replayDetected) {
      throw new CloudPermissionError(
        'Refresh token replay detected; session revoked',
        401,
        'unauthenticated'
      );
    }
    return outcome.result;
  }

  async revokeSession(sessionId: string, actorUserId: string): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2',
      [sessionId, actorUserId]
    );
    return (res.rowCount || 0) > 0;
  }

  async saveOAuthState(record: OAuthStateRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_states (
        state, nonce, code_verifier, flow_kind, redirect_uri, cli_challenge, cli_redirect_uri, cli_state, elevate, requested_workspace, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.state,
        record.nonce,
        record.codeVerifier,
        record.flowKind,
        record.redirectUri,
        record.cliChallenge || null,
        record.cliRedirectUri || null,
        record.cliState || null,
        record.elevate,
        record.requestedWorkspace || null,
        record.expiresAt,
      ]
    );
  }

  async consumeOAuthState(state: string): Promise<OAuthStateRecord | null> {
    const res = await this.pool.query(
      'DELETE FROM oauth_states WHERE state = $1 RETURNING *',
      [state]
    );
    const row = res.rows[0];
    if (!row || Date.parse(this.iso(row.expires_at)) <= Date.now()) return null;
    return {
      state: String(row.state),
      nonce: String(row.nonce),
      codeVerifier: String(row.code_verifier),
      flowKind: String(row.flow_kind) as 'web' | 'cli_loopback',
      redirectUri: String(row.redirect_uri),
      ...(row.cli_challenge ? { cliChallenge: String(row.cli_challenge) } : {}),
      ...(row.cli_redirect_uri ? { cliRedirectUri: String(row.cli_redirect_uri) } : {}),
      ...(row.cli_state ? { cliState: String(row.cli_state) } : {}),
      elevate: Boolean(row.elevate),
      ...(row.requested_workspace ? { requestedWorkspace: String(row.requested_workspace) } : {}),
      expiresAt: this.iso(row.expires_at),
    };
  }

  async saveCliAuthCode(record: CliAuthCodeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO cli_auth_codes (
        code_hash, user_id, code_challenge, redirect_uri, elevate, default_workspace_id, device_label, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.codeHash,
        record.userId,
        record.codeChallenge,
        record.redirectUri,
        record.elevate,
        record.defaultWorkspaceId || null,
        record.deviceLabel,
        record.expiresAt,
      ]
    );
  }

  async consumeCliAuthCode(codeHash: string): Promise<CliAuthCodeRecord | null> {
    const res = await this.pool.query(
      `UPDATE cli_auth_codes SET consumed_at = NOW()
       WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING *`,
      [codeHash]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      codeHash: String(row.code_hash),
      userId: String(row.user_id),
      codeChallenge: String(row.code_challenge),
      redirectUri: String(row.redirect_uri),
      elevate: Boolean(row.elevate),
      ...(row.default_workspace_id
        ? { defaultWorkspaceId: String(row.default_workspace_id) }
        : {}),
      deviceLabel: String(row.device_label || ''),
      expiresAt: this.iso(row.expires_at),
      consumedAt: this.iso(row.consumed_at),
    };
  }

  async createDeviceAuthCode(record: DeviceAuthRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_auth_codes (
        device_code_hash, user_code, status, user_id, elevate, default_workspace_id, device_label, interval_sec, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.deviceCodeHash,
        record.userCode,
        record.status,
        record.userId || null,
        record.elevate,
        record.defaultWorkspaceId || null,
        record.deviceLabel,
        record.intervalSec,
        record.expiresAt,
        record.createdAt,
      ]
    );
  }

  private mapDeviceCode(row: Record<string, unknown>): DeviceAuthRecord {
    return {
      deviceCodeHash: String(row.device_code_hash),
      userCode: String(row.user_code),
      status: String(row.status) as DeviceAuthRecord['status'],
      ...(row.user_id ? { userId: String(row.user_id) } : {}),
      elevate: Boolean(row.elevate),
      ...(row.default_workspace_id
        ? { defaultWorkspaceId: String(row.default_workspace_id) }
        : {}),
      deviceLabel: String(row.device_label || ''),
      intervalSec: Number(row.interval_sec || 2),
      expiresAt: this.iso(row.expires_at),
      createdAt: this.iso(row.created_at),
    };
  }

  async getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthRecord | null> {
    const res = await this.pool.query(
      'SELECT * FROM device_auth_codes WHERE UPPER(user_code) = UPPER($1)',
      [userCode.trim()]
    );
    return res.rows[0] ? this.mapDeviceCode(res.rows[0]) : null;
  }

  async getDeviceAuthByDeviceCodeHash(deviceCodeHash: string): Promise<DeviceAuthRecord | null> {
    const res = await this.pool.query(
      'SELECT * FROM device_auth_codes WHERE device_code_hash = $1',
      [deviceCodeHash]
    );
    return res.rows[0] ? this.mapDeviceCode(res.rows[0]) : null;
  }

  async approveDeviceAuthCode(
    userCode: string,
    userId: string,
    defaultWorkspaceId?: string,
    elevate?: boolean
  ): Promise<DeviceAuthRecord | null> {
    const res = await this.pool.query(
      `UPDATE device_auth_codes
       SET status = 'approved', user_id = $1,
           default_workspace_id = COALESCE($2, default_workspace_id),
           elevate = COALESCE($3, elevate)
       WHERE UPPER(user_code) = UPPER($4) AND status = 'pending' AND expires_at > NOW()
       RETURNING *`,
      [userId, defaultWorkspaceId || null, elevate ?? null, userCode.trim()]
    );
    return res.rows[0] ? this.mapDeviceCode(res.rows[0]) : null;
  }

  async consumeDeviceAuthCode(deviceCodeHash: string): Promise<DeviceAuthRecord | null> {
    const res = await this.pool.query(
      `UPDATE device_auth_codes SET status = 'consumed'
       WHERE device_code_hash = $1 AND status = 'approved' AND user_id IS NOT NULL AND expires_at > NOW()
       RETURNING *`,
      [deviceCodeHash]
    );
    return res.rows[0] ? this.mapDeviceCode(res.rows[0]) : null;
  }

  private async getUserGroupIds(workspaceId: string, email: string): Promise<Set<string>> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT g.id FROM groups g
       INNER JOIN group_members gm ON gm.group_id = g.id
       WHERE g.workspace_id = $1 AND LOWER(gm.member_email) = LOWER($2)`,
      [workspaceId, email.trim()]
    );
    return new Set(res.rows.map((r) => r.id));
  }

  private matchesBindingPrincipal(
    row: Record<string, unknown>,
    ctx: AuthPrincipalContext,
    groupIds: Set<string>
  ): boolean {
    if (!ctx.authenticated || !ctx.user) return false;
    if (!isBindingActive({ expiresAt: row.expires_at ? this.iso(row.expires_at) : undefined })) {
      return false;
    }
    const pType = String(row.principal_type) as PrincipalType;
    const pKey = String(row.principal_key);
    if (pType === 'user') return pKey === ctx.user.id;
    if (pType === 'group') return groupIds.has(pKey);
    if (pType === 'domain') {
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
    const groupIds = await this.getUserGroupIds(workspaceId, ctx.user.email);
    const res = await this.pool.query(
      "SELECT * FROM role_bindings WHERE workspace_id = $1 AND resource_type = 'workspace' AND resource_key = $2",
      [workspaceId, workspaceId]
    );
    const ranks = res.rows
      .filter((r) => this.matchesBindingPrincipal(r, ctx, groupIds))
      .map((r) => Number(r.role_rank));
    return computeMaxRoleRank(ranks);
  }

  private async resolveProjectRank(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectRow: Record<string, unknown> | null,
    projectSlug: string,
    groupIds: Set<string>
  ): Promise<number> {
    const ranks: number[] = [];
    const inheritWs = projectRow ? Boolean(projectRow.inherit_workspace_acl) : true;
    const wsRows = await this.pool.query(
      "SELECT * FROM role_bindings WHERE workspace_id = $1 AND resource_type = 'workspace' AND resource_key = $2",
      [workspaceId, workspaceId]
    );
    for (const r of wsRows.rows) {
      if (this.matchesBindingPrincipal(r, ctx, groupIds)) {
        const rank = Number(r.role_rank);
        if (inheritWs || rank >= ROLE_RANK.owner) ranks.push(rank);
      }
    }
    if (projectRow) {
      const pRows = await this.pool.query(
        "SELECT * FROM role_bindings WHERE workspace_id = $1 AND resource_type = 'project' AND resource_key = $2",
        [workspaceId, String(projectRow.id)]
      );
      for (const r of pRows.rows) {
        if (this.matchesBindingPrincipal(r, ctx, groupIds)) ranks.push(Number(r.role_rank));
      }
    }
    if (ctx.shareLink && ctx.shareLink.workspaceId === workspaceId) {
      const check = isShareLinkValidForContext(ctx.shareLink, ctx);
      if (
        check.valid &&
        ctx.shareLink.targetSpec.kind === 'project' &&
        (ctx.shareLink.targetSpec.projectSlug || '').toLowerCase() === projectSlug.toLowerCase()
      ) {
        ranks.push(ROLE_RANK[ctx.shareLink.role]);
      }
    }
    return ranks.length > 0 ? Math.max(...ranks) : 0;
  }

  private async resolveArtifactRank(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    artRow: Record<string, unknown>,
    groupIds?: Set<string>
  ): Promise<number> {
    const groups =
      groupIds ?? (ctx.user ? await this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>());
    const projectId = String(artRow.project_id);
    const projectSlug = String(artRow.project_slug);
    const category = String(artRow.category || '');
    const artifactId = String(artRow.id);

    const pRes = await this.pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    const ranks: number[] = [];
    const projRank = await this.resolveProjectRank(
      ctx,
      workspaceId,
      pRes.rows[0] || null,
      projectSlug,
      groups
    );
    if (projRank > 0) ranks.push(projRank);

    const catRes = await this.pool.query(
      "SELECT * FROM role_bindings WHERE workspace_id = $1 AND resource_type = 'category'",
      [workspaceId]
    );
    for (const r of catRes.rows) {
      const rk = String(r.resource_key);
      if (!rk.startsWith(`${projectId}:`)) continue;
      const prefix = rk.slice(projectId.length + 1);
      if (matchesCategoryPrefix(category, prefix) && this.matchesBindingPrincipal(r, ctx, groups)) {
        ranks.push(Number(r.role_rank));
      }
    }

    const artRes = await this.pool.query(
      "SELECT * FROM role_bindings WHERE workspace_id = $1 AND resource_type = 'artifact' AND resource_key = $2",
      [workspaceId, artifactId]
    );
    for (const r of artRes.rows) {
      if (this.matchesBindingPrincipal(r, ctx, groups)) ranks.push(Number(r.role_rank));
    }

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
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return null;
    const rank = await this.resolveArtifactRank(ctx, workspaceId, row);
    const role = rankToRole(rank);
    return { artifact: this.mapArtifactMetadata(row, role || undefined), role };
  }

  async listWorkspacesForUser(userId: string, googleHd?: string): Promise<Workspace[]> {
    const user = await this.getUserById(userId);
    if (!user) return [];
    const ctx: AuthPrincipalContext = {
      authenticated: true,
      user: { ...user, ...(googleHd ? { googleHd } : {}) },
      scopes: ['artifacts:read'],
      viaAgent: 'web',
    };
    const wsRows = await this.pool.query(
      'SELECT * FROM workspaces ORDER BY is_personal DESC, created_at ASC'
    );
    const out: Workspace[] = [];
    for (const ws of wsRows.rows) {
      const wsId = String(ws.id);
      const role = await this.resolveWorkspaceRole(ctx, wsId);
      if (role) {
        out.push(this.mapWorkspace(ws, role));
        continue;
      }
      const groups = await this.getUserGroupIds(wsId, user.email);
      const bRes = await this.pool.query('SELECT * FROM role_bindings WHERE workspace_id = $1', [
        wsId,
      ]);
      if (bRes.rows.some((b) => this.matchesBindingPrincipal(b, ctx, groups))) {
        out.push(this.mapWorkspace(ws, 'viewer'));
      }
    }
    return out;
  }

  async getWorkspace(idOrSlug: string): Promise<Workspace | null> {
    const res = await this.pool.query(
      'SELECT * FROM workspaces WHERE id::text = $1 OR slug = $1',
      [idOrSlug]
    );
    return res.rows[0] ? this.mapWorkspace(res.rows[0]) : null;
  }

  async createWorkspace(
    ctx: AuthPrincipalContext,
    input: { slug?: string; name: string; allowedGoogleHd?: string }
  ): Promise<Workspace> {
    if (!ctx.authenticated || !ctx.user) {
      throw new CloudPermissionError('Authentication required', 401, 'unauthenticated');
    }
    const id = crypto.randomUUID();
    return this.withTx(async (tx) => {
      const slug = await this.uniqueWorkspaceSlug(tx, input.slug || input.name);
      const res = await tx.query(
        `INSERT INTO workspaces (id, slug, name, is_personal, allowed_google_hd, created_by)
         VALUES ($1, $2, $3, FALSE, $4, $5) RETURNING *`,
        [
          id,
          slug,
          input.name.trim() || slug,
          input.allowedGoogleHd ? input.allowedGoogleHd.trim().toLowerCase() : null,
          ctx.user!.id,
        ]
      );
      await tx.query(
        `INSERT INTO role_bindings (id, workspace_id, principal_type, principal_key, resource_type, resource_key, role_rank, granted_by)
         VALUES ($1, $2, 'user', $3, 'workspace', $4, 40, $5)`,
        [crypto.randomUUID(), id, ctx.user!.id, id, ctx.user!.id]
      );
      await this.recordAudit(tx, {
        workspaceId: id,
        ctx,
        action: 'WORKSPACE_CREATE',
        resourceType: 'workspace',
        resourceId: id,
        details: { slug, name: input.name },
      });
      return this.mapWorkspace(res.rows[0], 'owner');
    });
  }

  private async ensureProjectRecord(
    workspaceId: string,
    projectSlugRaw: string,
    actorUserId: string
  ): Promise<Record<string, unknown>> {
    const slug = normalizeProjectName(projectSlugRaw) || 'general';
    const existing = await this.pool.query(
      'SELECT * FROM projects WHERE workspace_id = $1 AND slug = $2',
      [workspaceId, slug]
    );
    if (existing.rows[0]) return existing.rows[0];
    const id = crypto.randomUUID();
    const res = await this.pool.query(
      `INSERT INTO projects (id, workspace_id, slug, name, inherit_workspace_acl, created_by)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       ON CONFLICT (workspace_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [id, workspaceId, slug, slug, actorUserId]
    );
    return res.rows[0];
  }

  async listProjects(ctx: AuthPrincipalContext, workspaceId: string): Promise<WorkspaceProject[]> {
    const groups = ctx.user ? await this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const res = await this.pool.query(
      'SELECT * FROM projects WHERE workspace_id = $1 ORDER BY slug ASC',
      [workspaceId]
    );
    const visible: WorkspaceProject[] = [];
    for (const r of res.rows) {
      const rank = await this.resolveProjectRank(ctx, workspaceId, r, String(r.slug), groups);
      let ok = rank >= ROLE_RANK.viewer;
      if (!ok) {
        const arts = await this.pool.query(
          'SELECT * FROM artifacts WHERE workspace_id = $1 AND project_id = $2',
          [workspaceId, String(r.id)]
        );
        for (const a of arts.rows) {
          if ((await this.resolveArtifactRank(ctx, workspaceId, a, groups)) > 0) {
            ok = true;
            break;
          }
        }
      }
      if (ok) {
        visible.push({
          id: String(r.id),
          workspaceId: String(r.workspace_id),
          slug: String(r.slug),
          name: String(r.name),
          inheritWorkspaceAcl: Boolean(r.inherit_workspace_acl),
          createdBy: String(r.created_by),
          createdAt: this.iso(r.created_at),
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
    const pRes = await this.pool.query(
      'SELECT * FROM projects WHERE workspace_id = $1 AND slug = $2',
      [workspaceId, cleanSlug]
    );
    if (!pRes.rows[0]) {
      throw new CloudPermissionError(`Project not found: ${projectSlug}`, 404, 'not_found');
    }
    const groups = ctx.user ? await this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const rank = await this.resolveProjectRank(ctx, workspaceId, pRes.rows[0], cleanSlug, groups);
    evaluateAccess(rankToRole(rank), ctx, 'iam:share', `project ${cleanSlug}`);
    const upd = await this.pool.query(
      'UPDATE projects SET inherit_workspace_acl = $1 WHERE id = $2 RETURNING *',
      [inheritWorkspaceAcl, String(pRes.rows[0].id)]
    );
    const r = upd.rows[0];
    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      slug: String(r.slug),
      name: String(r.name),
      inheritWorkspaceAcl: Boolean(r.inherit_workspace_acl),
      createdBy: String(r.created_by),
      createdAt: this.iso(r.created_at),
    };
  }

  private async hydrateGroup(row: Record<string, unknown>): Promise<WorkspaceGroup> {
    const mRes = await this.pool.query<{ member_email: string }>(
      `SELECT member_email FROM group_members
       WHERE group_id = $1 ORDER BY member_email ASC`,
      [String(row.id)]
    );
    const memberEmails = mRes.rows.map((m) => String(m.member_email));
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      slug: String(row.slug),
      name: String(row.name),
      description: String(row.description || ''),
      memberEmails,
      memberCount: memberEmails.length,
      createdAt: this.iso(row.created_at),
    };
  }

  async listGroups(ctx: AuthPrincipalContext, workspaceId: string): Promise<WorkspaceGroup[]> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'artifact:read', `workspace ${workspaceId}`);
    const res = await this.pool.query(
      'SELECT * FROM groups WHERE workspace_id = $1 ORDER BY name ASC',
      [workspaceId]
    );
    return Promise.all(res.rows.map((r) => this.hydrateGroup(r)));
  }

  async createGroup(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: { slug?: string; name: string; description?: string; memberEmails?: string[] }
  ): Promise<WorkspaceGroup> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
    const id = crypto.randomUUID();
    const base = slugify(input.slug || input.name) || 'team';
    let slug = base;
    let c = 2;
    while (
      (
        await this.pool.query('SELECT 1 FROM groups WHERE workspace_id = $1 AND slug = $2', [
          workspaceId,
          slug,
        ])
      ).rows.length > 0
    ) {
      slug = `${base}-${c++}`;
    }
    const res = await this.pool.query(
      `INSERT INTO groups (id, workspace_id, slug, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, workspaceId, slug, input.name.trim() || slug, input.description || '', ctx.user!.id]
    );
    for (const rawEmail of input.memberEmails || []) {
      const email = rawEmail.trim().toLowerCase();
      if (email) {
        await this.pool.query(
          'INSERT INTO group_members (group_id, member_email, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, email, ctx.user!.id]
        );
      }
    }
    return this.hydrateGroup(res.rows[0]);
  }

  async updateGroupMembers(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    groupIdOrSlug: string,
    input: { addEmails?: string[]; removeEmails?: string[] }
  ): Promise<WorkspaceGroup> {
    const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    evaluateAccess(wsRole, ctx, 'iam:share', `workspace ${workspaceId}`);
    const gRes = await this.pool.query(
      'SELECT * FROM groups WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
      [workspaceId, groupIdOrSlug]
    );
    if (!gRes.rows[0]) {
      throw new CloudPermissionError(`Group not found: ${groupIdOrSlug}`, 404, 'not_found');
    }
    const groupId = String(gRes.rows[0].id);
    for (const rawEmail of input.addEmails || []) {
      const email = rawEmail.trim().toLowerCase();
      if (email) {
        await this.pool.query(
          'INSERT INTO group_members (group_id, member_email, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [groupId, email, ctx.user!.id]
        );
      }
    }
    for (const rawEmail of input.removeEmails || []) {
      const email = rawEmail.trim().toLowerCase();
      if (email) {
        await this.pool.query(
          'DELETE FROM group_members WHERE group_id = $1 AND LOWER(member_email) = LOWER($2)',
          [groupId, email]
        );
      }
    }
    return this.hydrateGroup(gRes.rows[0]);
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
    if (resourceType === 'workspace') {
      resolvedKey = workspaceId;
      evaluateAccess(await this.resolveWorkspaceRole(authCtx, workspaceId), authCtx, 'artifact:read');
    } else if (resourceType === 'project') {
      const pRes = await this.pool.query(
        'SELECT * FROM projects WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
        [workspaceId, resourceKey]
      );
      if (!pRes.rows[0]) throw new CloudPermissionError('Project not found', 404, 'not_found');
      projectRow = pRes.rows[0];
      resolvedKey = String(projectRow.id);
      const groups = await this.getUserGroupIds(workspaceId, authCtx.user!.email);
      const rank = await this.resolveProjectRank(
        authCtx,
        workspaceId,
        projectRow,
        String(projectRow.slug),
        groups
      );
      evaluateAccess(rankToRole(rank), authCtx, 'artifact:read');
    } else if (resourceType === 'category') {
      const [projRef, ...rest] = resourceKey.split(':');
      const pRes = await this.pool.query(
        'SELECT * FROM projects WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
        [workspaceId, projRef]
      );
      if (!pRes.rows[0]) throw new CloudPermissionError('Project not found', 404, 'not_found');
      projectRow = pRes.rows[0];
      resolvedKey = normalizeCategoryKey(String(projectRow.id), rest.join(':'));
      const groups = await this.getUserGroupIds(workspaceId, authCtx.user!.email);
      const rank = await this.resolveProjectRank(
        authCtx,
        workspaceId,
        projectRow,
        String(projectRow.slug),
        groups
      );
      evaluateAccess(rankToRole(rank), authCtx, 'artifact:read');
    } else if (resourceType === 'artifact') {
      const art = await this.findArtifactRow(workspaceId, resourceKey);
      if (!art) throw new CloudPermissionError('Artifact not found', 404, 'not_found');
      resolvedKey = String(art.id);
      const rank = await this.resolveArtifactRank(authCtx, workspaceId, art);
      evaluateAccess(rankToRole(rank), authCtx, 'artifact:read');
    } else {
      throw new CloudPermissionError('Invalid resourceType', 400, 'insufficient_role');
    }

    const directRes = await this.pool.query(
      'SELECT * FROM role_bindings WHERE workspace_id = $1 AND resource_type = $2 AND resource_key = $3 ORDER BY role_rank DESC',
      [workspaceId, resourceType, resolvedKey]
    );
    return {
      resourceType,
      resourceKey: resolvedKey,
      directBindings: await Promise.all(directRes.rows.map((r) => this.mapBinding(r))),
      inheritedBindings: [],
      ...(projectRow ? { inheritWorkspaceAcl: Boolean(projectRow.inherit_workspace_acl) } : {}),
    };
  }

  private async resolveBatchTargets(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    specs: BatchShareRequest['resources'],
    requireSharePermission: boolean
  ): Promise<Array<{ resourceType: ResourceType; resourceKey: string; actorRank: number }>> {
    const out: Array<{ resourceType: ResourceType; resourceKey: string; actorRank: number }> = [];
    const seen = new Set<string>();
    const groups = ctx.user ? await this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const push = (rt: ResourceType, rk: string, actorRank: number) => {
      const k = `${rt}:${rk}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ resourceType: rt, resourceKey: rk, actorRank });
      }
    };

    for (const s of specs) {
      if (!s || typeof s !== 'object') {
        throw new CloudPermissionError('Invalid resource target specification', 400, 'insufficient_role');
      }
      if (s.type === 'workspace') {
        const wsRole = await this.resolveWorkspaceRole(ctx, workspaceId);
        if (requireSharePermission) {
          evaluateAccess(wsRole, ctx, 'iam:share');
        }
        const actorRank = wsRole ? ROLE_RANK[wsRole] : 0;
        push('workspace', workspaceId, actorRank);
      } else if (s.type === 'project') {
        if (typeof s.id !== 'string' || !s.id) {
          throw new CloudPermissionError('Invalid project target id', 400, 'insufficient_role');
        }
        const pRes = await this.pool.query(
          'SELECT * FROM projects WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
          [workspaceId, s.id]
        );
        if (!pRes.rows[0]) throw new CloudPermissionError(`Project not found: ${s.id}`, 404, 'not_found');
        const proj = pRes.rows[0];
        const rank = await this.resolveProjectRank(ctx, workspaceId, proj, String(proj.slug), groups);
        if (requireSharePermission) {
          evaluateAccess(rankToRole(rank), ctx, 'iam:share');
        }
        push('project', String(proj.id), rank);
      } else if (s.type === 'category') {
        if (typeof s.projectId !== 'string' || typeof s.prefix !== 'string') {
          throw new CloudPermissionError('Invalid category target spec', 400, 'insufficient_role');
        }
        const pRes = await this.pool.query(
          'SELECT * FROM projects WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
          [workspaceId, s.projectId]
        );
        if (!pRes.rows[0]) throw new CloudPermissionError(`Project not found: ${s.projectId}`, 404, 'not_found');
        const proj = pRes.rows[0];
        const rank = await this.resolveProjectRank(ctx, workspaceId, proj, String(proj.slug), groups);
        if (requireSharePermission) {
          evaluateAccess(rankToRole(rank), ctx, 'iam:share');
        }
        push('category', normalizeCategoryKey(String(proj.id), s.prefix), rank);
      } else if (s.type === 'artifact') {
        if (typeof s.id !== 'string' || !s.id) {
          throw new CloudPermissionError('Invalid artifact target id', 400, 'insufficient_role');
        }
        const art = await this.findArtifactRow(workspaceId, s.id);
        if (!art) throw new CloudPermissionError(`Artifact not found: ${s.id}`, 404, 'not_found');
        const rank = await this.resolveArtifactRank(ctx, workspaceId, art, groups);
        if (requireSharePermission) {
          evaluateAccess(rankToRole(rank), ctx, 'iam:share');
        }
        push('artifact', String(art.id), rank);
      } else if (s.type === 'filter') {
        if (requireSharePermission && !ctx.scopes.includes('iam:share')) {
          throw new CloudPermissionError(
            `Active session (${ctx.sessionKind || 'delegated'}) lacks scope "iam:share". Run "myartifact login --elevate" or use the Web Studio.`,
            403,
            'agent_scope_restricted'
          );
        }
        const rows = await this.queryArtifactRows(workspaceId, {
          project: s.project,
          tag: s.tag,
          query: s.query,
          limit: 500,
        });
        for (const art of rows) {
          const rank = await this.resolveArtifactRank(ctx, workspaceId, art, groups);
          if (rank >= ROLE_RANK.admin && ctx.scopes.includes('iam:share')) {
            push('artifact', String(art.id), rank);
          }
        }
      } else {
        throw new CloudPermissionError('Invalid resource target type', 400, 'insufficient_role');
      }
    }
    return out;
  }

  private async resolveBatchPrincipals(
    workspaceId: string,
    specs: BatchShareRequest['principals']
  ): Promise<Array<{ principalType: PrincipalType; principalKey: string; pendingEmail?: string; userId?: string }>> {
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
        const u = await this.getUserByEmail(email);
        const pt: PrincipalType = u ? 'user' : 'pending_email';
        const pk = u ? u.id : email;
        if (!seen.has(`${pt}:${pk}`)) {
          seen.add(`${pt}:${pk}`);
          resolved.push({
            principalType: pt,
            principalKey: pk,
            ...(u ? { userId: u.id } : { pendingEmail: email }),
          });
        }
      } else if (p.type === 'group') {
        if (typeof p.groupId !== 'string' || !p.groupId) {
          throw new CloudPermissionError('Invalid groupId', 400, 'insufficient_role');
        }
        const gRes = await this.pool.query(
          'SELECT id FROM groups WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
          [workspaceId, p.groupId]
        );
        if (!gRes.rows[0]) throw new CloudPermissionError(`Group not found: ${p.groupId}`, 404, 'not_found');
        const pk = String(gRes.rows[0].id);
        if (!seen.has(`group:${pk}`)) {
          seen.add(`group:${pk}`);
          resolved.push({ principalType: 'group', principalKey: pk });
        }
      } else if (p.type === 'domain') {
        if (typeof p.domain !== 'string') continue;
        const dom = p.domain.trim().toLowerCase().replace(/^@+/, '');
        if (dom && dom.includes('.') && !seen.has(`domain:${dom}`)) {
          seen.add(`domain:${dom}`);
          resolved.push({ principalType: 'domain', principalKey: dom });
        }
      } else {
        throw new CloudPermissionError('Invalid principal type', 400, 'insufficient_role');
      }
    }
    return resolved;
  }

  private async assertHasOtherActiveWorkspaceOwner(
    tx: PgClientLike,
    workspaceId: string,
    excludeBindingId: string
  ): Promise<void> {
    const ownerRes = await tx.query<{ id: string; expires_at: unknown }>(
      `SELECT id, expires_at FROM role_bindings
       WHERE workspace_id = $1 AND resource_type = 'workspace' AND resource_key = $2
         AND principal_type = 'user' AND role_rank >= $3 AND id != $4
       FOR UPDATE`,
      [workspaceId, workspaceId, ROLE_RANK.owner, excludeBindingId]
    );
    const hasOtherActiveOwner = ownerRes.rows.some((r) =>
      isBindingActive({ expiresAt: r.expires_at ? this.iso(r.expires_at) : undefined })
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
    const targets = await this.resolveBatchTargets(ctx, workspaceId, request.resources, true);
    if (targets.length === 0) {
      throw new CloudPermissionError('No matching target resources found', 400, 'not_found');
    }
    for (const t of targets) {
      if (targetRank > t.actorRank) {
        throw new CloudPermissionError(
          'Cannot grant a role higher than your own effective role',
          403,
          'insufficient_role'
        );
      }
    }
    const principals = await this.resolveBatchPrincipals(workspaceId, request.principals);
    const mode = request.mode || 'upgrade_only';
    const nextExpiresAt = request.expiresAt || null;

    let applied = 0;
    let upgraded = 0;
    let unchanged = 0;
    const pendingEmailInvites = new Set<string>();
    const resolvedUserIds = new Set<string>();
    const bindingRows: Record<string, unknown>[] = [];

    await this.withTx(async (tx) => {
      if (targets.some((t) => t.resourceType === 'workspace')) {
        await tx.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
      }
      for (const t of targets) {
        for (const p of principals) {
          if (p.pendingEmail) pendingEmailInvites.add(p.pendingEmail);
          if (p.userId) resolvedUserIds.add(p.userId);

          const ex = await tx.query(
            `SELECT * FROM role_bindings
             WHERE workspace_id = $1 AND principal_type = $2 AND principal_key = $3
               AND resource_type = $4 AND resource_key = $5
             FOR UPDATE`,
            [workspaceId, p.principalType, p.principalKey, t.resourceType, t.resourceKey]
          );
          if (ex.rows[0]) {
            const curRank = Number(ex.rows[0].role_rank);
            if (curRank > t.actorRank) {
              throw new CloudPermissionError(
                'Cannot modify a binding higher than your own effective role',
                403,
                'insufficient_role'
              );
            }
            const curExpiresAt = ex.rows[0].expires_at ? this.iso(ex.rows[0].expires_at) : null;
            if (mode === 'upgrade_only' && curRank >= targetRank) {
              unchanged++;
              bindingRows.push(ex.rows[0]);
            } else if (curRank !== targetRank || nextExpiresAt !== curExpiresAt) {
              const isDowngradingWorkspaceOwner =
                t.resourceType === 'workspace' &&
                curRank >= ROLE_RANK.owner &&
                p.principalType === 'user' &&
                (targetRank < ROLE_RANK.owner ||
                  (nextExpiresAt !== null && !isBindingActive({ expiresAt: nextExpiresAt })));
              if (isDowngradingWorkspaceOwner) {
                await this.assertHasOtherActiveWorkspaceOwner(
                  tx,
                  workspaceId,
                  String(ex.rows[0].id)
                );
              }
              const upd = await tx.query(
                'UPDATE role_bindings SET role_rank = $1, granted_by = $2, expires_at = $3 WHERE id = $4 RETURNING *',
                [targetRank, ctx.user!.id, nextExpiresAt, ex.rows[0].id]
              );
              upgraded++;
              bindingRows.push(upd.rows[0]);
            } else {
              unchanged++;
              bindingRows.push(ex.rows[0]);
            }
          } else {
            const ins = await tx.query(
              `INSERT INTO role_bindings (id, workspace_id, principal_type, principal_key, resource_type, resource_key, role_rank, granted_by, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
              [
                crypto.randomUUID(),
                workspaceId,
                p.principalType,
                p.principalKey,
                t.resourceType,
                t.resourceKey,
                targetRank,
                ctx.user!.id,
                nextExpiresAt,
              ]
            );
            applied++;
            bindingRows.push(ins.rows[0]);
          }
        }
      }
      await this.recordAudit(tx, {
        workspaceId,
        ctx,
        action: 'BATCH_SHARE',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { role: request.role, mode, applied, upgraded, targetCount: targets.length },
      });
    });

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
      bindings: await Promise.all(bindingRows.map((r) => this.mapBinding(r))),
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
    const targets = await this.resolveBatchTargets(ctx, workspaceId, request.resources, true);
    const principals = await this.resolveBatchPrincipals(workspaceId, request.principals);
    let revokedCount = 0;

    await this.withTx(async (tx) => {
      if (targets.some((t) => t.resourceType === 'workspace')) {
        await tx.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
      }
      for (const t of targets) {
        for (const p of principals) {
          const ex = await tx.query(
            `SELECT * FROM role_bindings
             WHERE workspace_id = $1 AND principal_type = $2 AND principal_key = $3
               AND resource_type = $4 AND resource_key = $5
             FOR UPDATE`,
            [workspaceId, p.principalType, p.principalKey, t.resourceType, t.resourceKey]
          );
          if (!ex.rows[0]) continue;

          const existingRank = Number(ex.rows[0].role_rank);
          if (existingRank > t.actorRank) {
            throw new CloudPermissionError(
              'Cannot revoke a binding higher than your own effective role',
              403,
              'insufficient_role'
            );
          }

          if (
            t.resourceType === 'workspace' &&
            existingRank >= ROLE_RANK.owner &&
            p.principalType === 'user'
          ) {
            await this.assertHasOtherActiveWorkspaceOwner(
              tx,
              workspaceId,
              String(ex.rows[0].id)
            );
          }

          const res = await tx.query('DELETE FROM role_bindings WHERE id = $1', [
            ex.rows[0].id,
          ]);
          revokedCount += res.rowCount || 0;
        }
      }
      await this.recordAudit(tx, {
        workspaceId,
        ctx,
        action: 'BATCH_REVOKE',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { revokedCount, targetCount: targets.length },
      });
    });

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
      for (const id of input.targetSpec.artifactIds) specs.push({ type: 'artifact', id });
    }
    if (specs.length === 0) specs.push({ type: 'workspace', id: workspaceId });
    await this.resolveBatchTargets(ctx, workspaceId, specs, true);

    const token = `ma_sl_${crypto.randomBytes(24).toString('base64url')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const id = crypto.randomUUID();
    const requiredHd =
      input.accessMode === 'domain'
        ? (input.requiredHd || ctx.user.googleHd || '').trim().toLowerCase()
        : null;
    if (input.accessMode === 'domain' && !requiredHd) {
      throw new CloudPermissionError('Domain share link requires requiredHd', 400, 'domain_mismatch');
    }

    const res = await this.pool.query(
      `INSERT INTO share_links (
        id, workspace_id, token_hash, token_prefix, access_mode, required_hd, role_rank, target_spec_json, label, created_by, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11) RETURNING *`,
      [
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
      ]
    );
    return { link: this.mapShareLink(res.rows[0]), token };
  }

  async listShareLinks(ctx: AuthPrincipalContext, workspaceId: string): Promise<ShareLink[]> {
    evaluateAccess(await this.resolveWorkspaceRole(ctx, workspaceId), ctx, 'iam:share');
    const res = await this.pool.query(
      'SELECT * FROM share_links WHERE workspace_id = $1 ORDER BY created_at DESC',
      [workspaceId]
    );
    return res.rows.map((r) => this.mapShareLink(r));
  }

  async revokeShareLink(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    linkId: string
  ): Promise<boolean> {
    evaluateAccess(await this.resolveWorkspaceRole(ctx, workspaceId), ctx, 'iam:share');
    const res = await this.pool.query(
      'UPDATE share_links SET revoked_at = NOW() WHERE workspace_id = $1 AND id = $2',
      [workspaceId, linkId]
    );
    return (res.rowCount || 0) > 0;
  }

  async resolveShareLinkByToken(token: string): Promise<ShareLink | null> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const res = await this.pool.query('SELECT * FROM share_links WHERE token_hash = $1', [tokenHash]);
    return res.rows[0] ? this.mapShareLink(res.rows[0]) : null;
  }

  async getShareLinkBundle(
    ctx: AuthPrincipalContext,
    token: string
  ): Promise<{ link: ShareLink; workspace: Workspace; artifacts: ArtifactMetadata[] }> {
    const link = await this.resolveShareLinkByToken(token);
    if (!link) throw new CloudPermissionError('Share link not found', 404, 'not_found');
    const valid = isShareLinkValidForContext(link, ctx);
    if (!valid.valid) {
      throw new CloudPermissionError(
        `Share link invalid (${valid.reason})`,
        valid.reason === 'unauthenticated' ? 401 : 403,
        valid.reason || 'insufficient_role'
      );
    }
    const workspace = await this.getWorkspace(link.workspaceId);
    if (!workspace) throw new CloudPermissionError('Workspace not found', 404, 'not_found');
    const linkCtx: AuthPrincipalContext = {
      ...ctx,
      shareLink: link,
      scopes: ctx.authenticated ? ctx.scopes : ['artifacts:read'],
    };
    const artifacts = await this.listArtifacts(linkCtx, link.workspaceId, {
      limit: 500,
    });
    return { link, workspace, artifacts };
  }

  private async findArtifactRow(
    workspaceId: string,
    idOrSlug: string
  ): Promise<Record<string, unknown> | null> {
    const res = await this.pool.query(
      'SELECT * FROM artifacts WHERE workspace_id = $1 AND (id::text = $2 OR slug = $2)',
      [workspaceId, idOrSlug]
    );
    return res.rows[0] || null;
  }

  private mapArtifactMetadata(row: Record<string, unknown>, effectiveRole?: Role): ArtifactMetadata {
    const tags = Array.isArray(row.tags_json) ? (row.tags_json as string[]) : [];
    const links = Array.isArray(row.links_json) ? (row.links_json as string[]) : [];
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
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private async hydrateArtifactDetail(
    row: Record<string, unknown>,
    effectiveRole?: Role
  ): Promise<ArtifactDetail> {
    const meta = this.mapArtifactMetadata(row, effectiveRole);
    const content = (await this.blobStore.getCasText(String(row.current_blob_sha256))) ?? '';
    const vRes = await this.pool.query(
      'SELECT * FROM artifact_versions WHERE artifact_id = $1 ORDER BY version ASC',
      [meta.id]
    );
    const versions: ArtifactVersion[] = vRes.rows.map((v) => ({
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
      createdAt: this.iso(v.created_at),
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
    const id = crypto.randomUUID();
    const inferred = inferTypeFromPathOrContent(undefined, input.content);
    const type: ArtifactType = input.type || inferred.type;
    const language = input.language || inferred.language;
    const slug = await this.uniqueArtifactSlug(workspaceId, input.slug || input.title);
    const agent = input.agent || ctx.viaAgent || 'user';
    const tags = input.tags || [];
    const projectSlug = inferWikiProject({ slug, title: input.title, project: input.project, tags });

    const groups = await this.getUserGroupIds(workspaceId, ctx.user.email);
    const exProj = await this.pool.query(
      'SELECT * FROM projects WHERE workspace_id = $1 AND slug = $2',
      [workspaceId, projectSlug]
    );
    const permRank = exProj.rows[0]
      ? await this.resolveProjectRank(ctx, workspaceId, exProj.rows[0], projectSlug, groups)
      : (() => 0)();
    const resolvedRank = exProj.rows[0]
      ? permRank
      : (() => null)();
    const finalRank =
      resolvedRank !== null
        ? resolvedRank
        : (() => 0)();
    let effRole = rankToRole(finalRank);
    if (!exProj.rows[0]) {
      effRole = await this.resolveWorkspaceRole(ctx, workspaceId);
    }
    evaluateAccess(effRole, ctx, 'artifact:write', `project ${projectSlug}`);

    const projRow = exProj.rows[0] || (await this.ensureProjectRecord(workspaceId, projectSlug, ctx.user.id));
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
    const searchBody = [slug, input.title, description, category, ...tags, input.content].join(' ');

    const res = await this.pool.query(
      `INSERT INTO artifacts (
        id, workspace_id, project_id, slug, title, description, type, language, agent, project_slug,
        category, tags_json, links_json, icon, current_version, current_blob_sha256, author_user_id, author_email, search_tsv
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, 1, $15, $16, $17, to_tsvector('english', $18))
      RETURNING *`,
      [
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
        searchBody,
      ]
    );
    await this.pool.query(
      `INSERT INTO artifact_versions (
        artifact_id, version, agent, summary, blob_sha256, byte_size, author_user_id, author_email
      ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [id, agent, summary, blob.sha256, blob.byteSize, ctx.user.id, ctx.user.email]
    );
    await this.recordAudit(this.pool, {
      workspaceId,
      ctx,
      action: 'ARTIFACT_CREATE',
      resourceType: 'artifact',
      resourceId: id,
      details: { slug, version: 1 },
    });
    const detail = await this.hydrateArtifactDetail(res.rows[0], effRole || 'editor');
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
    const existingRow = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!existingRow) throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    const rank = await this.resolveArtifactRank(ctx, workspaceId, existingRow);
    const role = rankToRole(rank);
    evaluateAccess(role, ctx, 'artifact:write', `artifact ${existingRow.slug}`);

    const meta = this.mapArtifactMetadata(existingRow, role || undefined);
    const title = input.title ?? meta.title;
    const inferred = inferTypeFromPathOrContent(undefined, input.content);
    const type: ArtifactType =
      input.type ?? (inferred.type !== 'markdown' ? inferred.type : meta.type);
    const language =
      input.language ??
      (type !== meta.type
        ? inferred.type === type
          ? inferred.language
          : getDefaultLanguageForType(type)
        : meta.language);
    const agent = input.agent ?? meta.agent;
    const tags = input.tags ?? meta.tags;
    const projectSlug = inferWikiProject({
      slug: meta.slug,
      title,
      project: input.project ?? meta.project,
      tags,
    });
    if (projectSlug.toLowerCase() !== meta.project.toLowerCase()) {
      const pRes = await this.pool.query(
        'SELECT * FROM projects WHERE workspace_id = $1 AND LOWER(slug) = LOWER($2)',
        [workspaceId, projectSlug]
      );
      const targetProj = pRes.rows[0] || null;
      const groups = ctx.user
        ? await this.getUserGroupIds(workspaceId, ctx.user.email)
        : new Set<string>();
      const targetWsRole = targetProj ? null : await this.resolveWorkspaceRole(ctx, workspaceId);
      const targetRank = targetProj
        ? await this.resolveProjectRank(ctx, workspaceId, targetProj, projectSlug, groups)
        : targetWsRole
        ? ROLE_RANK[targetWsRole]
        : 0;
      evaluateAccess(rankToRole(targetRank), ctx, 'artifact:write', `target project ${projectSlug}`);
    }
    const projRow = await this.ensureProjectRecord(
      workspaceId,
      projectSlug,
      ctx.user?.id || String(existingRow.author_user_id || '')
    );
    const category = inferWikiCategory({
      slug: meta.slug,
      title,
      type,
      tags,
      category: input.category ?? meta.category,
      content: input.content,
    });
    const links = extractWikiLinks(input.content, input.links ?? meta.links, meta.slug);
    const description = extractAutoDescription(input.description ?? meta.description, title, type, input.content);
    const icon = resolveArtifactIconSvg({
      slug: meta.slug,
      title,
      type,
      tags,
      icon: input.icon ?? meta.icon,
      content: input.content,
    });
    const blob = await this.blobStore.putCasText(input.content);
    const contentChanged = String(existingRow.current_blob_sha256) !== blob.sha256;
    const nextVersion = contentChanged ? meta.currentVersion + 1 : meta.currentVersion;

    if (contentChanged) {
      await this.pool.query(
        `INSERT INTO artifact_versions (
          artifact_id, version, agent, summary, blob_sha256, byte_size, author_user_id, author_email
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          meta.id,
          nextVersion,
          agent,
          input.summary || `Updated to v${nextVersion}`,
          blob.sha256,
          blob.byteSize,
          ctx.user?.id || null,
          ctx.user?.email || '',
        ]
      );
    }

    const searchBody = [meta.slug, title, description, category, ...tags, input.content].join(' ');
    const upd = await this.pool.query(
      `UPDATE artifacts
       SET title = $1, description = $2, type = $3, language = $4, agent = $5, project_id = $6, project_slug = $7,
           category = $8, tags_json = $9::jsonb, links_json = $10::jsonb, icon = $11, current_version = $12,
           current_blob_sha256 = $13, search_tsv = to_tsvector('english', $14), updated_at = NOW()
       WHERE id = $15 RETURNING *`,
      [
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
        searchBody,
        meta.id,
      ]
    );
    const detail = await this.hydrateArtifactDetail(upd.rows[0], role || undefined);
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
    const existing = await this.findArtifactRow(workspaceId, slug);
    if (existing) {
      return this.updateArtifact(ctx, workspaceId, String(existing.id), {
        ...input,
        content: input.content,
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
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError(`Artifact not found: ${idOrSlug}`, 404, 'not_found');
    const rank = await this.resolveArtifactRank(ctx, workspaceId, row);
    evaluateAccess(rankToRole(rank), ctx, 'artifact:write');
    const vRes = await this.pool.query<{ blob_sha256: string }>(
      'SELECT blob_sha256 FROM artifact_versions WHERE artifact_id = $1 AND version = $2',
      [String(row.id), targetVersion]
    );
    if (!vRes.rows[0]) throw new CloudPermissionError('Version not found', 404, 'not_found');
    const content = await this.blobStore.getCasText(vRes.rows[0].blob_sha256);
    if (content === null) throw new CloudPermissionError('Blob missing', 404, 'not_found');
    const inferred = inferTypeFromPathOrContent(undefined, content);
    return this.updateArtifact(ctx, workspaceId, String(row.id), {
      content,
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
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return null;
    const rank = await this.resolveArtifactRank(ctx, workspaceId, row);
    const role = rankToRole(rank);
    evaluateAccess(role, ctx, 'artifact:read');
    return this.hydrateArtifactDetail(row, role || undefined);
  }

  async getVersionContent(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    version: number
  ): Promise<string | null> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return null;
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'artifact:read');
    const vRes = await this.pool.query<{ blob_sha256: string }>(
      'SELECT blob_sha256 FROM artifact_versions WHERE artifact_id = $1 AND version = $2',
      [String(row.id), version]
    );
    return vRes.rows[0] ? this.blobStore.getCasText(vRes.rows[0].blob_sha256) : null;
  }

  private async queryArtifactRows(
    workspaceId: string,
    filter: ListArtifactsFilter = {}
  ): Promise<Record<string, unknown>[]> {
    const conds = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (filter.query && filter.query.trim()) {
      params.push(filter.query.trim());
      conds.push(`search_tsv @@ plainto_tsquery('english', $${params.length})`);
    }
    if (filter.agent && filter.agent !== 'all') {
      params.push(filter.agent);
      conds.push(`agent = $${params.length}`);
    }
    if (filter.type) {
      params.push(filter.type);
      conds.push(`type = $${params.length}`);
    }
    params.push(clampQueryLimit(filter.limit, 200));
    const res = await this.pool.query(
      `SELECT * FROM artifacts WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.filter((row) => {
      if (filter.project && filter.project !== 'all') {
        const np = normalizeProjectName(filter.project) || filter.project.trim().toLowerCase();
        if (String(row.project_slug).toLowerCase() !== np) return false;
      }
      if (filter.category && filter.category !== 'all') {
        const nc = normalizeWikiCategory(filter.category);
        const rc = String(row.category || '');
        if (rc !== nc && !rc.startsWith(`${nc}/`)) return false;
      }
      if (filter.tag) {
        const tags = Array.isArray(row.tags_json) ? (row.tags_json as string[]) : [];
        if (!tags.includes(filter.tag)) return false;
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
    const rows = await this.queryArtifactRows(workspaceId, filter);
    const groups = ctx.user ? await this.getUserGroupIds(workspaceId, ctx.user.email) : new Set<string>();
    const out: ArtifactMetadata[] = [];
    for (const r of rows) {
      const role = rankToRole(await this.resolveArtifactRank(ctx, workspaceId, r, groups));
      if (role) out.push(this.mapArtifactMetadata(r, role));
    }
    return out;
  }

  async deleteArtifact(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<boolean> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return false;
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'artifact:delete');
    await this.pool.query('DELETE FROM artifacts WHERE id = $1', [String(row.id)]);
    await this.pool.query(
      "DELETE FROM role_bindings WHERE workspace_id = $1 AND resource_type = 'artifact' AND resource_key = $2",
      [workspaceId, String(row.id)]
    );
    await this.publish({
      type: 'artifact:deleted',
      workspaceId,
      artifactId: String(row.id),
      payload: { type: 'artifact:deleted', id: idOrSlug, artifactId: String(row.id) },
    });
    return true;
  }

  async getStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; value: string } | null> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError('Artifact not found', 404, 'not_found');
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'artifact:read');
    const res = await this.pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM artifact_kv_store WHERE artifact_id = $1 AND key = $2',
      [String(row.id), key]
    );
    return res.rows[0] || null;
  }

  async setStorageValue(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    key: string,
    value: string
  ): Promise<{ key: string; value: string }> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError('Artifact not found', 404, 'not_found');
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'storage:write');
    const artifactId = String(row.id);
    const strVal = String(value);
    const newBytes = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(strVal, 'utf8');
    const tot = await this.pool.query<{ total: string }>(
      'SELECT COALESCE(SUM(byte_size), 0)::text AS total FROM artifact_kv_store WHERE artifact_id = $1 AND key != $2',
      [artifactId, key]
    );
    if (Number(tot.rows[0]?.total || 0) + newBytes > MAX_STORAGE_BYTES) {
      throw new Error('Artifact storage limit exceeded (max 20 MB per artifact)');
    }
    await this.pool.query(
      `INSERT INTO artifact_kv_store (artifact_id, key, value, byte_size, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (artifact_id, key) DO UPDATE SET value = EXCLUDED.value, byte_size = EXCLUDED.byte_size, updated_at = NOW()`,
      [artifactId, key, strVal, newBytes]
    );
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
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError('Artifact not found', 404, 'not_found');
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'storage:write');
    const res = await this.pool.query(
      'DELETE FROM artifact_kv_store WHERE artifact_id = $1 AND key = $2',
      [String(row.id), key]
    );
    return { key, deleted: (res.rowCount || 0) > 0 };
  }

  async listStorageKeys(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string,
    prefix = ''
  ): Promise<{ keys: string[]; prefix: string }> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) throw new CloudPermissionError('Artifact not found', 404, 'not_found');
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'artifact:read');
    const safePrefix = typeof prefix === 'string' ? prefix : '';
    const escapedPrefix = escapeSqlLikePrefix(safePrefix);
    const res = await this.pool.query<{ key: string }>(
      "SELECT key FROM artifact_kv_store WHERE artifact_id = $1 AND key LIKE $2 ESCAPE '\\' ORDER BY key ASC",
      [String(row.id), `${escapedPrefix}%`]
    );
    return { keys: res.rows.map((r) => r.key), prefix: safePrefix };
  }

  async getAllStorageEntries(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<StorageEntry[]> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return [];
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'artifact:read');
    const res = await this.pool.query<{ key: string; value: string; updated_at: unknown }>(
      'SELECT key, value, updated_at FROM artifact_kv_store WHERE artifact_id = $1 ORDER BY key ASC',
      [String(row.id)]
    );
    return res.rows.map((r) => ({ key: r.key, value: r.value, updatedAt: this.iso(r.updated_at) }));
  }

  async clearStorage(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<void> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return;
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'storage:write');
    await this.pool.query('DELETE FROM artifact_kv_store WHERE artifact_id = $1', [String(row.id)]);
  }

  async getWikiData(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    projectFilter?: string
  ): Promise<WikiTaxonomy & { indexMarkdown: string; logMarkdown: string }> {
    const items = await this.listArtifacts(ctx, workspaceId, { project: projectFilter, limit: 1000 });
    const visibleSlugs = new Set(items.map((i) => i.slug));
    const byProject = new Map<string, Map<string, ArtifactMetadata[]>>();
    const catMap = new Map<string, string[]>();
    const backlinks: Record<string, string[]> = {};

    for (const item of items) {
      const p = item.project || 'general';
      const c = item.category || 'concepts/general';
      if (!byProject.has(p)) byProject.set(p, new Map());
      if (!byProject.get(p)!.has(c)) byProject.get(p)!.set(c, []);
      byProject.get(p)!.get(c)!.push(item);
      if (!catMap.has(c)) catMap.set(c, []);
      catMap.get(c)!.push(item.slug);
      for (const t of item.links || []) {
        if (!visibleSlugs.has(t)) continue;
        if (!backlinks[t]) backlinks[t] = [];
        if (!backlinks[t].includes(item.slug)) backlinks[t].push(item.slug);
      }
    }

    const projects: WikiTaxonomy['projects'] = [];
    const lines = ['# MyArtifact Cloud LLM Wiki — Master Index (`index.md`)', ''];
    for (const proj of Array.from(byProject.keys()).sort()) {
      const pCats = byProject.get(proj)!;
      const cats = Array.from(pCats.keys())
        .sort()
        .map((category) => {
          const list = pCats.get(category)!;
          return { category, count: list.length, slugs: list.map((a) => a.slug) };
        });
      projects.push({
        project: proj,
        count: cats.reduce((s, c) => s + c.count, 0),
        categories: cats,
      });
      lines.push(`## Project: \`${proj}\``);
      for (const c of cats) {
        lines.push(`### \`${proj}\` / \`${c.category}\``);
        for (const item of pCats.get(c.category)!) {
          lines.push(`- **[[${item.slug}]]** — ${item.title} (\`${item.type}\` · \`v${item.currentVersion}\`)`);
        }
      }
    }
    const categories = Array.from(catMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, slugs]) => ({ category, count: slugs.length, slugs }));

    return {
      projects,
      categories,
      backlinks,
      indexMarkdown: lines.join('\n'),
      logMarkdown: '# MyArtifact Cloud LLM Wiki — Operation Log (`log.md`)\n',
    };
  }

  async logTensorBoardScalars(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: LogScalarsInput
  ): Promise<ArtifactDetail> {
    const cleanSlug = slugify(input.slug);
    const existing = await this.findArtifactRow(workspaceId, cleanSlug);
    let base: TensorBoardRunManifest = {
      runSlug: cleanSlug,
      title: input.title || cleanSlug,
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
    let artifact: ArtifactDetail;
    if (existing) {
      const rank = await this.resolveArtifactRank(ctx, workspaceId, existing);
      const role = rankToRole(rank);
      evaluateAccess(role, ctx, 'tb:write', `run ${cleanSlug}`);
      artifact = await this.hydrateArtifactDetail(existing, role || undefined);
      try {
        const parsed = JSON.parse(artifact.content) as Partial<TensorBoardRunManifest>;
        base = {
          ...base,
          ...parsed,
          title: input.title || parsed.title || artifact.title,
          experiment: input.experiment || parsed.experiment || base.experiment,
          modelName: input.modelName || parsed.modelName || base.modelName,
          framework: input.framework || parsed.framework || base.framework,
          status: input.status || parsed.status || base.status,
          hparams: { ...(parsed.hparams || {}), ...(input.hparams || {}) },
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Keep base manifest
      }
    } else {
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
      artifact = await this.createArtifact(ctx, workspaceId, {
        slug: cleanSlug,
        title: base.title,
        type: 'tensorboard',
        language: 'tensorboard',
        agent: input.agent || ctx.viaAgent,
        project: input.project || base.experiment,
        content: JSON.stringify(base, null, 2),
      });
    }

    const nowSec = input.wallTime ?? Date.now() / 1000;
    const pts: TensorBoardScalarPoint[] = [...(input.scalars || [])];
    if (input.metrics) {
      for (const [tag, value] of Object.entries(input.metrics)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          pts.push({ tag, step: input.step ?? 0, epoch: input.epoch, value, wallTime: nowSec });
        }
      }
    }
    for (const pt of pts) {
      await this.pool.query(
        `INSERT INTO tb_scalars (artifact_id, tag, step, epoch, value, wall_time)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (artifact_id, tag, step) DO UPDATE SET epoch = COALESCE(EXCLUDED.epoch, tb_scalars.epoch), value = EXCLUDED.value, wall_time = EXCLUDED.wall_time`,
        [artifact.id, pt.tag, pt.step, pt.epoch ?? null, pt.value, pt.wallTime || nowSec]
      );
    }
    const sRes = await this.pool.query(
      'SELECT tag, step, epoch, value, wall_time FROM tb_scalars WHERE artifact_id = $1 ORDER BY tag ASC, step ASC',
      [artifact.id]
    );
    const scalars: Record<string, TensorBoardScalarPoint[]> = {};
    for (const r of sRes.rows) {
      const tag = String(r.tag);
      if (!scalars[tag]) scalars[tag] = [];
      scalars[tag].push({
        tag,
        step: Number(r.step),
        ...(r.epoch !== null && r.epoch !== undefined ? { epoch: Number(r.epoch) } : {}),
        value: Number(r.value),
        wallTime: Number(r.wall_time),
      });
    }
    const checkpoints = await this.getModelCheckpoints(ctx, workspaceId, artifact.id);
    const full = { ...base, scalars, checkpoints, updatedAt: new Date().toISOString() };
    return this.updateArtifact(ctx, workspaceId, artifact.id, {
      title: full.title,
      content: JSON.stringify(full, null, 2),
      agent: input.agent || ctx.viaAgent,
      summary: input.summary || `Logged ${pts.length} scalar point(s)`,
    });
  }

  async saveModelCheckpoint(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    input: SaveModelCheckpointInput
  ): Promise<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }> {
    const cleanSlug = slugify(input.slug);
    const existing = await this.findArtifactRow(workspaceId, cleanSlug);
    if (!existing) {
      await this.logTensorBoardScalars(ctx, workspaceId, { slug: cleanSlug, title: input.title });
    }
    const presigned = await this.presignCheckpointUpload(ctx, workspaceId, cleanSlug, {
      name: input.name || `checkpoint-step-${input.step ?? 0}.${input.format || 'safetensors'}`,
    });
    const payload =
      input.content !== undefined
        ? Buffer.isBuffer(input.content)
          ? input.content
          : Buffer.from(String(input.content), 'utf8')
        : Buffer.from(JSON.stringify({ runSlug: cleanSlug, step: input.step ?? 0 }), 'utf8');
    await this.blobStore.putObject(presigned.objectKey, payload);
    return this.finalizeCheckpointUpload(ctx, workspaceId, cleanSlug, {
      checkpointId: presigned.checkpointId,
      objectKey: presigned.objectKey,
      name: input.name || `checkpoint-step-${input.step ?? 0}.${input.format || 'safetensors'}`,
      step: input.step,
      epoch: input.epoch,
      format: input.format,
      metrics: input.metrics,
      metadata: input.metadata,
      isBest: input.isBest,
      agent: input.agent,
      summary: input.summary,
    });
  }

  async presignCheckpointUpload(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    runSlug: string,
    input: { name: string; contentType?: string }
  ) {
    const cleanSlug = slugify(runSlug);
    const existing = await this.findArtifactRow(workspaceId, cleanSlug);
    if (existing) {
      evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, existing)), ctx, 'tb:write');
    } else {
      evaluateAccess(await this.resolveWorkspaceRole(ctx, workspaceId), ctx, 'tb:write');
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
    const existing = await this.findArtifactRow(workspaceId, cleanSlug);
    if (existing) {
      evaluateAccess(
        rankToRole(await this.resolveArtifactRank(ctx, workspaceId, existing)),
        ctx,
        'tb:write',
        `run ${cleanSlug}`
      );
    } else {
      evaluateAccess(
        await this.resolveWorkspaceRole(ctx, workspaceId),
        ctx,
        'tb:write',
        `workspace ${workspaceId}`
      );
    }

    assertValidCheckpointFinalizeInput(workspaceId, cleanSlug, input.checkpointId, input.objectKey);

    const buf = await this.blobStore.getObjectBuffer(input.objectKey);
    if (!buf) throw new CloudPermissionError('Checkpoint object missing', 404, 'not_found');

    const art = existing
      ? await this.hydrateArtifactDetail(existing)
      : await this.logTensorBoardScalars(ctx, workspaceId, { slug: cleanSlug, agent: input.agent });
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const format = (input.format || path.extname(input.name).replace(/^\./, '') || 'safetensors').toLowerCase();
    if (input.isBest) {
      await this.pool.query('UPDATE tb_checkpoints SET is_best = FALSE WHERE artifact_id = $1', [art.id]);
    }
    const res = await this.pool.query(
      `INSERT INTO tb_checkpoints (
        id, artifact_id, run_slug, name, step, epoch, object_key, format, byte_size, sha256, metrics_json, metadata_json, is_best
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13) RETURNING *`,
      [
        input.checkpointId,
        art.id,
        cleanSlug,
        input.name,
        input.step ?? 0,
        input.epoch ?? null,
        input.objectKey,
        format,
        buf.byteLength,
        sha256,
        JSON.stringify(input.metrics || {}),
        JSON.stringify(input.metadata || {}),
        Boolean(input.isBest),
      ]
    );
    const ckptRow = res.rows[0];
    const checkpoint: ModelCheckpoint = {
      id: String(ckptRow.id),
      runSlug: String(ckptRow.run_slug),
      name: String(ckptRow.name),
      step: Number(ckptRow.step),
      ...(ckptRow.epoch !== null && ckptRow.epoch !== undefined ? { epoch: Number(ckptRow.epoch) } : {}),
      filePath: String(ckptRow.object_key),
      format: String(ckptRow.format),
      byteSize: Number(ckptRow.byte_size),
      sha256: String(ckptRow.sha256),
      metrics: (ckptRow.metrics_json || {}) as Record<string, number>,
      metadata: (ckptRow.metadata_json || {}) as Record<string, unknown>,
      isBest: Boolean(ckptRow.is_best),
      createdAt: this.iso(ckptRow.created_at),
    };
    const updatedArtifact = await this.updateArtifact(ctx, workspaceId, art.id, {
      content: art.content,
      agent: input.agent || ctx.viaAgent,
      summary: input.summary || `Saved checkpoint ${checkpoint.name}`,
    });
    return { artifact: updatedArtifact, checkpoint };
  }

  async getModelCheckpoints(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    idOrSlug: string
  ): Promise<ModelCheckpoint[]> {
    const row = await this.findArtifactRow(workspaceId, idOrSlug);
    if (!row) return [];
    evaluateAccess(rankToRole(await this.resolveArtifactRank(ctx, workspaceId, row)), ctx, 'artifact:read');
    const res = await this.pool.query(
      'SELECT * FROM tb_checkpoints WHERE artifact_id = $1 ORDER BY step DESC, created_at DESC',
      [String(row.id)]
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      runSlug: String(r.run_slug),
      name: String(r.name),
      step: Number(r.step),
      ...(r.epoch !== null && r.epoch !== undefined ? { epoch: Number(r.epoch) } : {}),
      filePath: String(r.object_key),
      format: String(r.format),
      byteSize: Number(r.byte_size),
      sha256: String(r.sha256),
      metrics: (r.metrics_json || {}) as Record<string, number>,
      metadata: (r.metadata_json || {}) as Record<string, unknown>,
      isBest: Boolean(r.is_best),
      createdAt: this.iso(r.created_at),
    }));
  }

  async getCheckpointDownloadUrl(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    checkpointId: string
  ): Promise<{ checkpoint: ModelCheckpoint; url: string } | null> {
    if (!isValidUuid(checkpointId)) return null;
    const res = await this.pool.query('SELECT * FROM tb_checkpoints WHERE id = $1', [checkpointId]);
    if (!res.rows[0]) return null;
    const ck = res.rows[0];
    const artRes = await this.pool.query(
      'SELECT * FROM artifacts WHERE id = $1 AND workspace_id = $2',
      [String(ck.artifact_id), workspaceId]
    );
    if (!artRes.rows[0]) return null;
    evaluateAccess(
      rankToRole(await this.resolveArtifactRank(ctx, workspaceId, artRes.rows[0])),
      ctx,
      'artifact:read'
    );
    const transfer = await this.blobStore.createPresignedDownload(
      String(ck.object_key),
      String(ck.name),
      900
    );
    return {
      checkpoint: {
        id: String(ck.id),
        runSlug: String(ck.run_slug),
        name: String(ck.name),
        step: Number(ck.step),
        filePath: String(ck.object_key),
        format: String(ck.format),
        byteSize: Number(ck.byte_size),
        sha256: String(ck.sha256),
        metrics: (ck.metrics_json || {}) as Record<string, number>,
        metadata: (ck.metadata_json || {}) as Record<string, unknown>,
        isBest: Boolean(ck.is_best),
        createdAt: this.iso(ck.created_at),
      },
      url: transfer.url,
    };
  }

  async listAuditEvents(
    ctx: AuthPrincipalContext,
    workspaceId: string,
    limit = 100
  ): Promise<AuditEvent[]> {
    evaluateAccess(await this.resolveWorkspaceRole(ctx, workspaceId), ctx, 'iam:share');
    const clampedLimit = clampQueryLimit(limit, 100);
    const res = await this.pool.query(
      'SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
      [workspaceId, clampedLimit]
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      ...(r.workspace_id ? { workspaceId: String(r.workspace_id) } : {}),
      ...(r.actor_user_id ? { actorUserId: String(r.actor_user_id) } : {}),
      actorEmail: String(r.actor_email || ''),
      viaAgent: String(r.via_agent || 'web'),
      ...(r.auth_session_id ? { authSessionId: String(r.auth_session_id) } : {}),
      action: String(r.action),
      resourceType: String(r.resource_type),
      resourceId: String(r.resource_id),
      details: (r.details_json || {}) as Record<string, unknown>,
      createdAt: this.iso(r.created_at),
    }));
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
        const kvRes = await this.pool.query<{ cnt: string; max_upd: string }>(
          "SELECT COUNT(*)::text AS cnt, COALESCE(MAX(updated_at)::text, '') AS max_upd FROM artifact_kv_store WHERE artifact_id = $1",
          [art.id]
        );
        const row = kvRes.rows[0];
        storageRevision = sha256Hex(
          `${art.id}:${Number(row?.cnt || 0)}:${String(row?.max_upd || '')}`
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
    this.listenClient?.release();
    await this.pool.end();
  }
}
