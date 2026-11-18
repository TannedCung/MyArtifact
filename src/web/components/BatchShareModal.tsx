import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  Link2,
  Lock,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { cloudFetch } from '../cloud-api.js';
import type {
  BatchSharePrincipalSpec,
  BatchShareResourceSpec,
  EffectiveAclDetail,
  ShareLink,
  UserProfile,
  WorkspaceGroup,
} from '../../core/types.js';

export type ShareModalTarget =
  | { kind: 'artifacts'; artifactIds: string[]; label: string }
  | { kind: 'project'; projectSlug: string; label: string }
  | { kind: 'category'; projectSlug: string; prefix: string; label: string };

export interface BatchShareModalProps {
  open: boolean;
  workspaceId: string;
  target: ShareModalTarget | null;
  user?: UserProfile | null;
  csrfToken?: string | null;
  onClose: () => void;
  onShared?: (message: string) => void;
}

export const BatchShareModal: React.FC<BatchShareModalProps> = ({
  open,
  workspaceId,
  target,
  user,
  csrfToken,
  onClose,
  onShared,
}) => {
  const [tab, setTab] = useState<'batch' | 'links' | 'acl'>('batch');
  const [emailsInput, setEmailsInput] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [upgradeOnly, setUpgradeOnly] = useState(true);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmails, setNewGroupEmails] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);

  const [links, setLinks] = useState<ShareLink[]>([]);
  const [linkAccessMode, setLinkAccessMode] = useState<'anyone' | 'domain'>('anyone');
  const [linkDomain, setLinkDomain] = useState(user?.googleHd || '');
  const [linkRole, setLinkRole] = useState<'viewer' | 'editor'>('viewer');
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);

  const [acl, setAcl] = useState<EffectiveAclDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadMetadata = async () => {
    if (!workspaceId || !target) return;
    const reqCtx = { workspaceId, csrfToken };
    const [gRes, lRes] = await Promise.all([
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/groups`, {}, reqCtx),
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/iam/share-links`, {}, reqCtx),
    ]);
    if (gRes.ok) {
      const gData = await gRes.json();
      setGroups(gData.groups || []);
    }
    if (lRes.ok) {
      const lData = await lRes.json();
      setLinks(lData.links || []);
    }

    if (
      (target.kind === 'artifacts' && target.artifactIds.length === 1) ||
      target.kind === 'project' ||
      target.kind === 'category'
    ) {
      const rType =
        target.kind === 'artifacts' ? 'artifact' : target.kind === 'project' ? 'project' : 'category';
      const rKey =
        target.kind === 'artifacts'
          ? target.artifactIds[0]
          : target.kind === 'project'
          ? target.projectSlug
          : `${target.projectSlug}:${target.prefix}`;
      const aclRes = await cloudFetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/iam/acl?resourceType=${encodeURIComponent(
          rType
        )}&resourceKey=${encodeURIComponent(rKey)}`,
        {},
        reqCtx
      );
      if (aclRes.ok) {
        setAcl(await aclRes.json());
      }
    } else {
      setAcl(null);
    }
  };

  useEffect(() => {
    if (open && workspaceId && target) {
      setStatusMsg(null);
      setCreatedShareUrl(null);
      setLinkDomain(user?.googleHd || '');
      void loadMetadata();
    }
  }, [open, workspaceId, target]);

  if (!open || !target) return null;

  const buildResources = (): BatchShareResourceSpec[] => {
    if (target.kind === 'artifacts') {
      return target.artifactIds.map((id) => ({ type: 'artifact', id }));
    }
    if (target.kind === 'project') {
      return [{ type: 'project', id: target.projectSlug }];
    }
    return [{ type: 'category', projectId: target.projectSlug, prefix: target.prefix }];
  };

  const handleApplyBatchShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const principals: BatchSharePrincipalSpec[] = [];
    const tokens = emailsInput
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));
    for (const email of tokens) {
      principals.push({ type: 'email', email });
    }
    for (const gId of selectedGroupIds) {
      principals.push({ type: 'group', groupId: gId });
    }
    if (domainInput.trim()) {
      principals.push({ type: 'domain', domain: domainInput.trim() });
    }
    if (principals.length === 0) {
      setStatusMsg('Enter at least one email, group, or Google domain.');
      return;
    }

    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await cloudFetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/iam/grants:batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resources: buildResources(),
            principals,
            role,
            mode: upgradeOnly ? 'upgrade_only' : 'set_exact',
          }),
        },
        { workspaceId, csrfToken }
      );
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error || 'Batch share failed');
        return;
      }
      const msg = `Shared ${data.targetResourceCount} resource(s): ${data.applied} granted, ${data.upgraded} upgraded${
        data.pendingEmailInvites?.length
          ? ` (${data.pendingEmailInvites.length} pending Google invite(s))`
          : ''
      }.`;
      setStatusMsg(msg);
      setEmailsInput('');
      setSelectedGroupIds([]);
      setDomainInput('');
      await loadMetadata();
      onShared?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    const memberEmails = newGroupEmails
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));
    const res = await cloudFetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/groups`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), memberEmails }),
      },
      { workspaceId, csrfToken }
    );
    if (res.ok) {
      const data = await res.json();
      setGroups((prev) => [...prev, data.group]);
      setSelectedGroupIds((prev) => [...prev, data.group.id]);
      setNewGroupName('');
      setNewGroupEmails('');
      setShowNewGroup(false);
    }
  };

  const handleCreateShareLink = async () => {
    setBusy(true);
    try {
      const targetSpec =
        target.kind === 'artifacts'
          ? {
              kind: target.artifactIds.length === 1 ? 'artifact' : 'collection',
              artifactIds: target.artifactIds,
            }
          : target.kind === 'project'
          ? { kind: 'project', projectSlug: target.projectSlug }
          : {
              kind: 'category',
              projectSlug: target.projectSlug,
              categoryPrefix: target.prefix,
            };

      const res = await cloudFetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/iam/share-links`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessMode: linkAccessMode,
            requiredHd: linkAccessMode === 'domain' ? linkDomain : undefined,
            role: linkRole,
            targetSpec,
            label: target.label,
          }),
        },
        { workspaceId, csrfToken }
      );
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error || 'Failed to create share link');
        return;
      }
      setCreatedShareUrl(data.shareUrl);
      try {
        await navigator.clipboard.writeText(data.shareUrl);
      } catch {
        // Ignore clipboard errors
      }
      await loadMetadata();
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    const res = await cloudFetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/iam/share-links/${encodeURIComponent(
        linkId
      )}`,
      { method: 'DELETE' },
      { workspaceId, csrfToken }
    );
    if (res.ok) {
      await loadMetadata();
    }
  };

  const handleToggleProjectPrivacy = async () => {
    if (target.kind !== 'project' || !acl) return;
    const nextInherit = !acl.inheritWorkspaceAcl;
    const res = await cloudFetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(
        target.projectSlug
      )}/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inheritWorkspaceAcl: nextInherit }),
      },
      { workspaceId, csrfToken }
    );
    if (res.ok) {
      await loadMetadata();
      onShared?.(nextInherit ? 'Project inherits Workspace members' : 'Project set to Private');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[580px] rounded-[14px] border border-line-strong bg-raised shadow-2xl p-5 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15.5px] font-semibold text-ink">Share {target.label}</h2>
            <p className="text-[12px] text-ink-3">
              Batch-grant RBAC roles across emails, groups, Google Workspace domains, or share links.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-sunken text-ink-3">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="inline-flex rounded-[8px] bg-sunken p-1 border border-line self-start">
          <button
            onClick={() => setTab('batch')}
            className={`px-3 py-1 rounded-[6px] text-[12px] font-medium flex items-center gap-1.5 ${
              tab === 'batch' ? 'bg-raised text-ink shadow-xs' : 'text-ink-3 hover:text-ink'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Batch Share</span>
          </button>
          <button
            onClick={() => setTab('links')}
            className={`px-3 py-1 rounded-[6px] text-[12px] font-medium flex items-center gap-1.5 ${
              tab === 'links' ? 'bg-raised text-ink shadow-xs' : 'text-ink-3 hover:text-ink'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Share Links</span>
          </button>
          {acl && (
            <button
              onClick={() => setTab('acl')}
              className={`px-3 py-1 rounded-[6px] text-[12px] font-medium flex items-center gap-1.5 ${
                tab === 'acl' ? 'bg-raised text-ink shadow-xs' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Who Has Access</span>
            </button>
          )}
        </div>

        {statusMsg && (
          <div className="rounded-[8px] border border-[var(--c-sage-border)] bg-sage-soft px-3 py-2 text-[12.5px] text-sage flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {tab === 'batch' && (
          <form onSubmit={handleApplyBatchShare} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
              <span>Emails (comma, space, or newline separated — unregistered emails auto-claim on Google login)</span>
              <textarea
                rows={2}
                value={emailsInput}
                onChange={(e) => setEmailsInput(e.target.value)}
                placeholder="alice@company.com, bob@partner.io, ..."
                className="p-2.5 rounded-[8px] bg-canvas border border-line-strong text-[12.5px] text-ink font-mono"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-ink-2">Workspace Groups</span>
                <button
                  type="button"
                  onClick={() => setShowNewGroup((v) => !v)}
                  className="text-[11.5px] text-sage hover:underline"
                >
                  {showNewGroup ? 'Cancel' : '+ New Group'}
                </button>
              </div>

              {showNewGroup && (
                <div className="p-2.5 rounded-[8px] border border-line bg-sunken/60 flex flex-col gap-2">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Group name (e.g. ML Platform)"
                    className="h-[30px] px-2 rounded-[6px] bg-canvas border border-line text-[12px]"
                  />
                  <input
                    type="text"
                    value={newGroupEmails}
                    onChange={(e) => setNewGroupEmails(e.target.value)}
                    placeholder="Member emails (comma-separated)"
                    className="h-[30px] px-2 rounded-[6px] bg-canvas border border-line text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateGroup}
                    className="h-[28px] px-3 rounded-[6px] bg-sage text-canvas text-[11.5px] self-end"
                  >
                    Create Group
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {groups.length === 0 ? (
                  <span className="text-[11.5px] text-ink-3">No workspace groups yet.</span>
                ) : (
                  groups.map((g) => {
                    const active = selectedGroupIds.includes(g.id);
                    return (
                      <button
                        type="button"
                        key={g.id}
                        onClick={() =>
                          setSelectedGroupIds((prev) =>
                            active ? prev.filter((id) => id !== g.id) : [...prev, g.id]
                          )
                        }
                        className={`h-[26px] px-2.5 rounded-full text-[11.5px] border transition-colors ${
                          active
                            ? 'bg-sage text-canvas border-sage'
                            : 'bg-canvas text-ink-2 border-line hover:bg-sunken'
                        }`}
                      >
                        @{g.slug} ({g.memberCount})
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                <span>Google Workspace Domain (optional)</span>
                <input
                  type="text"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder={user?.googleHd ? `e.g. ${user.googleHd}` : 'e.g. company.com'}
                  className="h-[34px] px-2.5 rounded-[8px] bg-canvas border border-line-strong text-[12.5px] text-ink font-mono"
                />
              </label>

              <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                <span>RBAC Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'viewer' | 'editor' | 'admin')}
                  className="h-[34px] px-2.5 rounded-[8px] bg-canvas border border-line-strong text-[12.5px] text-ink"
                >
                  <option value="viewer">Viewer (Read + Interactive View)</option>
                  <option value="editor">Editor (Read + Version + Storage)</option>
                  <option value="admin">Admin (Share + Delete + Manage)</option>
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
              <input
                type="checkbox"
                checked={upgradeOnly}
                onChange={(e) => setUpgradeOnly(e.target.checked)}
              />
              <span>Safe upgrade-only mode (never downgrade users who already hold a higher role)</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={onClose}
                className="h-[34px] px-3.5 rounded-[8px] border border-line text-[12.5px] text-ink-2 hover:bg-sunken"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-[34px] px-4 rounded-[8px] bg-sage hover:bg-sage-hover text-canvas text-[12.5px] font-medium disabled:opacity-50"
              >
                {busy ? 'Applying…' : 'Apply Batch Share'}
              </button>
            </div>
          </form>
        )}

        {tab === 'links' && (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                <span>Access Scope</span>
                <select
                  value={linkAccessMode}
                  onChange={(e) => setLinkAccessMode(e.target.value as 'anyone' | 'domain')}
                  className="h-[34px] px-2 rounded-[8px] bg-canvas border border-line-strong text-[12.5px]"
                >
                  <option value="anyone">Anyone with link</option>
                  <option value="domain">Google Domain only</option>
                </select>
              </label>

              {linkAccessMode === 'domain' && (
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                  <span>Required Domain</span>
                  <input
                    type="text"
                    value={linkDomain}
                    onChange={(e) => setLinkDomain(e.target.value)}
                    placeholder="company.com"
                    className="h-[34px] px-2.5 rounded-[8px] bg-canvas border border-line-strong text-[12.5px] font-mono"
                  />
                </label>
              )}

              <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                <span>Link Permission</span>
                <select
                  value={linkRole}
                  onChange={(e) => setLinkRole(e.target.value as 'viewer' | 'editor')}
                  className="h-[34px] px-2 rounded-[8px] bg-canvas border border-line-strong text-[12.5px]"
                >
                  <option value="viewer">Viewer (Safe CoW State)</option>
                  <option value="editor">Editor</option>
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={handleCreateShareLink}
              disabled={busy}
              className="h-[36px] px-4 rounded-[8px] bg-sage hover:bg-sage-hover text-canvas text-[12.5px] font-medium flex items-center justify-center gap-2"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Create &amp; Copy Capability Link</span>
            </button>

            {createdShareUrl && (
              <div className="p-2.5 rounded-[8px] bg-sunken border border-line flex items-center justify-between gap-2">
                <span className="font-mono text-[11.5px] truncate text-ink">{createdShareUrl}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(createdShareUrl)}
                  className="p-1.5 rounded hover:bg-raised text-ink-2"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1.5 max-h-[190px] overflow-y-auto">
              {links.map((l) => (
                <div
                  key={l.id}
                  className="px-3 py-2 rounded-[8px] border border-line bg-canvas flex items-center justify-between gap-2 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink truncate">
                      {l.label || l.targetSpec.kind} ·{' '}
                      <span className="font-mono text-[11px] text-ink-3">
                        {l.tokenPrefix}… ({l.accessMode}
                        {l.requiredHd ? ` @${l.requiredHd}` : ''})
                      </span>
                    </div>
                  </div>
                  {l.revokedAt ? (
                    <span className="text-[11px] font-mono text-danger-ink">revoked</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRevokeLink(l.id)}
                      className="text-[11px] text-danger-ink hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'acl' && acl && (
          <div className="flex flex-col gap-3">
            {target.kind === 'project' && (
              <div className="p-3 rounded-[9px] border border-line bg-sunken/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <Lock className="w-4 h-4 text-sage shrink-0" />
                  <div>
                    <div className="font-medium text-ink">
                      {acl.inheritWorkspaceAcl
                        ? 'Inheriting Workspace Members'
                        : 'Private Project (Workspace isolation active)'}
                    </div>
                    <div className="text-[11px] text-ink-3">
                      Private projects restrict access to explicit grantees &amp; Workspace Owners.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleProjectPrivacy}
                  className="h-[28px] px-2.5 rounded-[6px] border border-line-strong bg-raised hover:bg-canvas text-[11.5px] font-medium"
                >
                  {acl.inheritWorkspaceAcl ? 'Make Private' : 'Inherit Workspace'}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
              {[...acl.directBindings, ...acl.inheritedBindings].map((b, i) => {
                const inheritedFrom =
                  'inheritedFrom' in b && typeof b.inheritedFrom === 'string'
                    ? b.inheritedFrom
                    : null;
                return (
                  <div
                    key={`${b.id}-${i}`}
                    className="px-3 py-2 rounded-[8px] border border-line bg-canvas flex items-center justify-between text-[12px]"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-ink">
                        {b.principalLabel || b.principalKey}
                      </span>
                      {inheritedFrom && (
                        <span className="ml-2 font-mono text-[10.5px] text-ink-3">
                          via {inheritedFrom}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-sage-soft text-sage">
                      {b.role}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
