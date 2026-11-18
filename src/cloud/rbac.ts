import {
  ROLE_RANK,
  rankToRole,
  type AgentScope,
  type AuthPrincipalContext,
  type Role,
  type RoleBinding,
  type ShareLink,
} from '../core/types.js';
import { normalizeWikiCategory } from '../core/storage.js';

export type CloudAction =
  | 'artifact:read'
  | 'artifact:write'
  | 'storage:write'
  | 'tb:write'
  | 'artifact:delete'
  | 'iam:share'
  | 'workspace:admin';

export const ACTION_REQUIREMENTS: Record<CloudAction, { minRole: Role; scope: AgentScope }> = {
  'artifact:read': { minRole: 'viewer', scope: 'artifacts:read' },
  'artifact:write': { minRole: 'editor', scope: 'artifacts:write' },
  'storage:write': { minRole: 'editor', scope: 'storage:write' },
  'tb:write': { minRole: 'editor', scope: 'tb:write' },
  'artifact:delete': { minRole: 'admin', scope: 'artifacts:delete' },
  'iam:share': { minRole: 'admin', scope: 'iam:share' },
  'workspace:admin': { minRole: 'owner', scope: 'workspace:admin' },
};

export type PermissionErrorCode =
  | 'unauthenticated'
  | 'insufficient_role'
  | 'agent_scope_restricted'
  | 'share_link_expired'
  | 'share_link_revoked'
  | 'domain_mismatch'
  | 'not_found';

export class CloudPermissionError extends Error {
  public readonly statusCode: number;
  public readonly code: PermissionErrorCode;

  constructor(message: string, statusCode: number, code: PermissionErrorCode) {
    super(message);
    this.name = 'CloudPermissionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function normalizeCategoryKey(projectId: string, prefix: string): string {
  const norm = normalizeWikiCategory(prefix);
  return `${projectId}:${norm}`;
}

export function matchesCategoryPrefix(artifactCategory: string, boundPrefix: string): boolean {
  const artCat = normalizeWikiCategory(artifactCategory);
  const target = normalizeWikiCategory(boundPrefix);
  if (!target) return true;
  return artCat === target || artCat.startsWith(`${target}/`);
}

export function isBindingActive(binding: Pick<RoleBinding, 'expiresAt'>, nowMs = Date.now()): boolean {
  if (!binding.expiresAt) return true;
  const exp = Date.parse(binding.expiresAt);
  return Number.isNaN(exp) || exp > nowMs;
}

export function isShareLinkValidForContext(
  link: ShareLink,
  ctx: AuthPrincipalContext,
  nowMs = Date.now()
): { valid: boolean; reason?: PermissionErrorCode } {
  if (link.revokedAt) {
    return { valid: false, reason: 'share_link_revoked' };
  }
  if (link.expiresAt) {
    const exp = Date.parse(link.expiresAt);
    if (!Number.isNaN(exp) && exp <= nowMs) {
      return { valid: false, reason: 'share_link_expired' };
    }
  }
  if (link.accessMode === 'domain') {
    if (!ctx.authenticated || !ctx.user) {
      return { valid: false, reason: 'unauthenticated' };
    }
    if (!ctx.user.emailVerified || !ctx.user.googleHd) {
      return { valid: false, reason: 'domain_mismatch' };
    }
    if (ctx.user.googleHd.toLowerCase() !== (link.requiredHd || '').toLowerCase()) {
      return { valid: false, reason: 'domain_mismatch' };
    }
  }
  return { valid: true };
}

export function shareLinkCoversArtifact(
  link: ShareLink,
  artifact: { id: string; project: string; category: string }
): boolean {
  const spec = link.targetSpec;
  if (spec.kind === 'project') {
    return (spec.projectSlug || '').toLowerCase() === artifact.project.toLowerCase();
  }
  if (spec.kind === 'category') {
    if (spec.projectSlug && spec.projectSlug.toLowerCase() !== artifact.project.toLowerCase()) {
      return false;
    }
    return matchesCategoryPrefix(artifact.category, spec.categoryPrefix || '');
  }
  if (spec.kind === 'artifact' || spec.kind === 'collection') {
    return Array.isArray(spec.artifactIds) && spec.artifactIds.includes(artifact.id);
  }
  return false;
}

export function evaluateAccess(
  effectiveRole: Role | null,
  ctx: AuthPrincipalContext,
  action: CloudAction,
  resourceLabel = 'resource'
): void {
  const req = ACTION_REQUIREMENTS[action];
  if (!effectiveRole) {
    if (!ctx.authenticated && !ctx.shareLink) {
      throw new CloudPermissionError(
        `Authentication required to access ${resourceLabel}`,
        401,
        'unauthenticated'
      );
    }
    throw new CloudPermissionError(
      `You do not have permission to perform ${action} on ${resourceLabel}`,
      403,
      'insufficient_role'
    );
  }

  if (ROLE_RANK[effectiveRole] < ROLE_RANK[req.minRole]) {
    throw new CloudPermissionError(
      `Role "${effectiveRole}" cannot perform ${action} (requires ${req.minRole})`,
      403,
      'insufficient_role'
    );
  }

  if (!ctx.scopes.includes(req.scope)) {
    throw new CloudPermissionError(
      `Active session (${ctx.sessionKind || 'delegated'}) lacks scope "${req.scope}". Run "myartifact login --elevate" or use the Web Studio.`,
      403,
      'agent_scope_restricted'
    );
  }
}

export function computeMaxRoleRank(ranks: number[]): Role | null {
  let max = 0;
  for (const r of ranks) {
    if (r > max) max = r;
  }
  return rankToRole(max);
}

export const CLI_ELEVATED_MAX_TTL_MS = 24 * 3600 * 1000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function assertBatchRequestShape(
  request: { resources?: unknown; principals?: unknown } | null | undefined
): void {
  if (!request || !Array.isArray(request.resources) || !Array.isArray(request.principals)) {
    throw new CloudPermissionError(
      'Batch request requires resources and principals arrays',
      400,
      'insufficient_role'
    );
  }
}

export function parseBatchGrantRole(role: unknown): { role: Role; rank: number } {
  if (typeof role !== 'string' || !Object.prototype.hasOwnProperty.call(ROLE_RANK, role)) {
    throw new CloudPermissionError('Invalid role', 400, 'insufficient_role');
  }
  const typedRole = role as Role;
  return { role: typedRole, rank: ROLE_RANK[typedRole] };
}

export function assertValidCheckpointFinalizeInput(
  workspaceId: string,
  cleanSlug: string,
  checkpointId: unknown,
  objectKey: unknown
): void {
  if (!isValidUuid(checkpointId)) {
    throw new CloudPermissionError('Invalid checkpointId', 400, 'insufficient_role');
  }
  const expectedPrefix = `workspaces/${workspaceId}/runs/${cleanSlug}/checkpoints/${checkpointId}/`;
  if (
    typeof objectKey !== 'string' ||
    objectKey.includes('..') ||
    objectKey.includes('\\') ||
    objectKey.includes('\0') ||
    !objectKey.startsWith(expectedPrefix) ||
    objectKey.length <= expectedPrefix.length
  ) {
    throw new CloudPermissionError('Invalid checkpoint objectKey', 403, 'insufficient_role');
  }
}

export function capSessionExpiresAt(
  sessionKind: string,
  createdAt: string,
  requestedExpiresAt: string,
  nowMs = Date.now()
): string {
  if (sessionKind !== 'cli_elevated') {
    return requestedExpiresAt;
  }
  const fallbackCapMs = nowMs + CLI_ELEVATED_MAX_TTL_MS;
  const createdMs = Date.parse(createdAt);
  const createdCapMs = Number.isFinite(createdMs)
    ? createdMs + CLI_ELEVATED_MAX_TTL_MS
    : fallbackCapMs;
  const maxAllowedMs = Math.min(createdCapMs, fallbackCapMs);
  const requestedMs = Date.parse(requestedExpiresAt);
  const effectiveMs = Number.isFinite(requestedMs)
    ? Math.min(requestedMs, maxAllowedMs)
    : maxAllowedMs;
  return new Date(effectiveMs).toISOString();
}

export function clampQueryLimit(limit: unknown, defaultLimit = 200): number {
  return Math.max(1, Math.min(1000, Math.floor(Number(limit) || defaultLimit)));
}

export function escapeSqlLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, '\\$&');
}
