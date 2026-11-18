import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  LogOut,
  Plus,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { cloudFetch } from '../cloud-api.js';
import type { AuthSessionInfo, UserProfile, Workspace } from '../../core/types.js';

function getSafeAvatarUrl(rawUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\x00-\x1f\x7f\s]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export interface WorkspaceBarProps {
  user: UserProfile;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  csrfToken?: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onWorkspaceCreated: (ws: Workspace) => void;
  onLoggedOut: () => void;
}

export const WorkspaceBar: React.FC<WorkspaceBarProps> = ({
  user,
  workspaces,
  activeWorkspaceId,
  csrfToken,
  onSelectWorkspace,
  onWorkspaceCreated,
  onLoggedOut,
}) => {
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [newWsOpen, setNewWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<AuthSessionInfo[]>([]);

  const safeAvatarUrl = getSafeAvatarUrl(user.avatarUrl);

  const activeWs =
    workspaces.find((w) => w.id === activeWorkspaceId || w.slug === activeWorkspaceId) ||
    workspaces[0];

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    const res = await cloudFetch(
      '/api/workspaces',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWsName.trim() }),
      },
      { csrfToken }
    );
    if (res.ok) {
      const data = await res.json();
      setNewWsName('');
      setNewWsOpen(false);
      setWsMenuOpen(false);
      onWorkspaceCreated(data.workspace);
    }
  };

  const openSessionsDrawer = async () => {
    setSessionsOpen(true);
    const res = await cloudFetch('/api/auth/sessions', {}, { csrfToken });
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
  };

  const revokeSession = async (id: string) => {
    const res = await cloudFetch(
      `/api/auth/sessions/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      { csrfToken }
    );
    if (res.ok) {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, revokedAt: new Date().toISOString() } : s))
      );
    }
  };

  const handleLogout = async () => {
    await cloudFetch('/api/auth/logout', { method: 'POST' }, { csrfToken });
    onLoggedOut();
  };

  return (
    <div className="px-3 py-2 border-b border-line bg-raised/70 flex flex-col gap-2 relative">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setWsMenuOpen((v) => !v)}
          className="flex-1 min-w-0 h-[30px] px-2 rounded-[7px] bg-sunken/80 hover:bg-sunken border border-line flex items-center gap-1.5 text-left transition-colors"
        >
          <Building2 className="w-3.5 h-3.5 text-sage shrink-0" />
          <span className="text-[12px] font-medium truncate text-ink">
            {activeWs ? activeWs.name : 'Workspace'}
          </span>
          {activeWs?.effectiveRole && (
            <span className="text-[10px] font-mono px-1 rounded bg-sage-soft text-sage shrink-0">
              {activeWs.effectiveRole}
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-ink-3 ml-auto shrink-0" />
        </button>

        <button
          onClick={openSessionsDrawer}
          title={`${user.email} — Manage CLI & Web Sessions`}
          className="h-[30px] px-2 rounded-[7px] border border-line bg-canvas hover:bg-sunken flex items-center gap-1.5 shrink-0 transition-colors"
        >
          {safeAvatarUrl ? (
            <img src={safeAvatarUrl} referrerPolicy="no-referrer" alt="" className="w-4 h-4 rounded-full" />
          ) : (
            <span className="w-4 h-4 rounded-full bg-sage text-canvas text-[10px] font-semibold flex items-center justify-center">
              {(user.displayName || user.email)[0]?.toUpperCase()}
            </span>
          )}
          <Terminal className="w-3 h-3 text-ink-3" />
        </button>
      </div>

      {wsMenuOpen && (
        <div className="absolute left-3 right-3 top-[42px] z-40 rounded-[10px] border border-line-strong bg-raised shadow-[0_10px_28px_rgba(30,36,32,0.16)] p-1.5 flex flex-col gap-1">
          {workspaces.map((w) => {
            const active = w.id === activeWs?.id;
            return (
              <button
                key={w.id}
                onClick={() => {
                  onSelectWorkspace(w.id);
                  setWsMenuOpen(false);
                }}
                className={`px-2.5 py-1.5 rounded-[7px] text-left flex items-center justify-between text-[12px] transition-colors ${
                  active ? 'bg-sage-soft text-ink font-medium' : 'hover:bg-sunken text-ink-2'
                }`}
              >
                <span className="truncate">{w.name}</span>
                <span className="font-mono text-[10px] text-ink-3">{w.effectiveRole}</span>
              </button>
            );
          })}
          <div className="border-t border-line my-0.5" />
          {newWsOpen ? (
            <form onSubmit={handleCreateWorkspace} className="flex gap-1 p-1">
              <input
                type="text"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="Team workspace name"
                autoFocus
                className="flex-1 min-w-0 h-[28px] px-2 rounded-[6px] bg-canvas border border-line-strong text-[12px] text-ink"
              />
              <button
                type="submit"
                className="h-[28px] px-2.5 rounded-[6px] bg-sage text-canvas text-[11.5px] font-medium"
              >
                Add
              </button>
            </form>
          ) : (
            <button
              onClick={() => setNewWsOpen(true)}
              className="px-2.5 py-1.5 rounded-[7px] text-[12px] text-sage hover:bg-sunken flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Team Workspace</span>
            </button>
          )}
        </div>
      )}

      {sessionsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={() => setSessionsOpen(false)}
        >
          <div
            className="w-full max-w-[540px] rounded-[12px] border border-line-strong bg-raised shadow-2xl p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">
                  Account &amp; Agent Sessions
                </h2>
                <p className="text-[12px] text-ink-3">
                  {user.displayName} · {user.email}
                  {user.googleHd ? ` (@${user.googleHd})` : ''}
                </p>
              </div>
              <button
                onClick={() => setSessionsOpen(false)}
                className="p-1 rounded hover:bg-sunken text-ink-3"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[280px] overflow-y-auto flex flex-col gap-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 rounded-[8px] border border-line bg-canvas flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink flex items-center gap-2">
                      <span className="truncate">{s.deviceLabel || s.sessionKind}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-sunken text-ink-2">
                        {s.sessionKind}
                      </span>
                      {s.revokedAt && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-danger-soft text-danger-ink">
                          revoked
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-ink-3 truncate mt-0.5">
                      scopes: {s.scopeCeiling.join(', ')}
                    </div>
                  </div>
                  {!s.revokedAt && (
                    <button
                      onClick={() => revokeSession(s.id)}
                      className="h-[26px] px-2 rounded-[6px] border border-line hover:bg-danger-soft hover:text-danger-ink text-[11px] flex items-center gap-1 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-line">
              <span className="text-[11.5px] font-mono text-ink-3">
                CLI login: myartifact login --cloud {window.location.origin}
              </span>
              <button
                onClick={handleLogout}
                className="h-[30px] px-3 rounded-[7px] bg-sunken hover:bg-danger-soft hover:text-danger-ink text-[12px] font-medium flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
