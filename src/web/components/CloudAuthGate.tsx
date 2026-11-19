import React, { useState } from 'react';
import { ShieldCheck, Terminal, Check, AlertCircle, Smartphone, Lock } from 'lucide-react';
import { MYARTIFACT_LOGO_SVG } from '../../core/icons.js';
import { cloudFetch } from '../cloud-api.js';
import type { UserProfile, Workspace } from '../../core/types.js';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseLoopbackRedirectUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface CloudAuthGateProps {
  mode: 'signin' | 'cli_authorize' | 'device';
  authenticated: boolean;
  user?: UserProfile | null;
  workspaces: Workspace[];
  csrfToken?: string | null;
  googleEnabled?: boolean;
  onApproved?: () => void;
  onBackToLanding?: () => void;
}

export const CloudAuthGate: React.FC<CloudAuthGateProps> = ({
  mode,
  authenticated,
  user,
  workspaces,
  csrfToken,
  googleEnabled = true,
  onApproved,
  onBackToLanding,
}) => {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const redirectUri = params.get('redirect_uri') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const state = params.get('state') || '';
  const elevate = params.get('elevate') === '1';
  const deviceLabel = params.get('device_label') || 'Local CLI & Agents';
  const parsedLoopbackUri = parseLoopbackRedirectUrl(redirectUri);
  const loopbackHostPort = parsedLoopbackUri
    ? parsedLoopbackUri.port
      ? `${parsedLoopbackUri.hostname}:${parsedLoopbackUri.port}`
      : parsedLoopbackUri.hostname
    : null;
  const initialWs = params.get('workspace') || workspaces[0]?.id || '';

  const [selectedWs, setSelectedWs] = useState<string>(initialWs);
  const [userCode, setUserCode] = useState<string>(params.get('user_code') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const buildGoogleLoginUrl = () => {
    if (mode === 'cli_authorize') {
      const qs = new URLSearchParams({
        flow: 'cli_loopback',
        cli_redirect_uri: redirectUri,
        cli_challenge: codeChallenge,
        ...(state ? { cli_state: state } : {}),
        ...(elevate ? { elevate: '1' } : {}),
        ...(selectedWs ? { workspace: selectedWs } : {}),
      });
      return `/api/auth/google/login?${qs.toString()}`;
    }
    const rawPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    const rawSearch = typeof window !== 'undefined' ? window.location.search : '';
    const next =
      rawPath === '/signin' || rawPath === '/welcome' || rawPath === '/about' || rawPath === '/features'
        ? '/'
        : `${rawPath}${rawSearch}`;
    return `/api/auth/google/login?next=${encodeURIComponent(next)}`;
  };

  const handleApproveCli = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await cloudFetch(
        '/api/auth/cli/approve',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirectUri,
            codeChallenge,
            state,
            elevate,
            workspace: selectedWs || workspaces[0]?.id,
            deviceLabel,
          }),
        },
        { csrfToken }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to authorize CLI');
        setBusy(false);
        return;
      }
      const safeRedirect = parseLoopbackRedirectUrl(data.redirectUrl);
      if (!safeRedirect) {
        setError('Invalid loopback redirect URL returned by server');
        setBusy(false);
        return;
      }
      setDoneMsg('Authorized! Redirecting back to CLI…');
      window.location.href = safeRedirect.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const handleApproveDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await cloudFetch(
        '/api/auth/device/approve',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userCode: userCode.trim().toUpperCase(),
            workspace: selectedWs || workspaces[0]?.id,
            elevate,
          }),
        },
        { csrfToken }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Device code invalid or expired');
        setBusy(false);
        return;
      }
      setDoneMsg(`Authorized device code ${data.userCode}. You may close this tab.`);
      onApproved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center px-4 py-6 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-[440px] min-w-0 rounded-[14px] border border-line bg-raised shadow-[0_12px_36px_rgba(30,36,32,0.10)] p-5 sm:p-7 flex flex-col gap-5">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-[9px] overflow-hidden border border-line shadow-xs shrink-0 [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
          />
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold tracking-tight text-ink">
              MyArtifact Cloud
            </h1>
            <p className="text-[12px] text-ink-3">
              Cross-Assistant Visual Studio &amp; RBAC Workspace
            </p>
          </div>
        </div>

        {!authenticated ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-[10px] border border-line bg-sunken/70 p-4 text-[13px] text-ink-2 leading-relaxed">
              {mode === 'cli_authorize'
                ? 'Sign in with Google to link your local CLI and coding agents (Claude Code, Codex, Antigravity) to your RBAC permissions.'
                : mode === 'device'
                ? 'Sign in with Google to authorize your headless CLI / SSH session.'
                : 'Sign in with your Google account to access shared visual artifacts, projects, and live workspaces.'}
            </div>

            {googleEnabled ? (
              <a
                href={buildGoogleLoginUrl()}
                className="h-[42px] px-4 rounded-[9px] bg-sage hover:bg-sage-hover text-canvas font-medium text-[13.5px] flex items-center justify-center gap-2.5 transition-colors shadow-xs"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </a>
            ) : (
              <div className="text-[12.5px] text-danger-ink bg-danger-soft border border-danger/30 rounded-[8px] p-3">
                Google OIDC client credentials are not configured on this server.
              </div>
            )}

            {mode === 'signin' && (
              onBackToLanding ? (
                <button
                  type="button"
                  onClick={onBackToLanding}
                  className="text-[12.5px] text-ink-3 hover:text-ink transition-colors text-center pt-1"
                >
                  ← Back to Product Overview
                </button>
              ) : (
                <a
                  href="/welcome"
                  className="text-[12.5px] text-ink-3 hover:text-ink transition-colors text-center pt-1 no-underline"
                >
                  ← Product Overview
                </a>
              )
            )}
          </div>
        ) : mode === 'signin' ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2 bg-sunken px-3 py-2 rounded-[8px] border border-line">
              <Check className="w-4 h-4 text-sage shrink-0" />
              <span className="truncate">
                Signed in as <strong className="text-ink">{user?.email}</strong>
              </span>
            </div>
            <a
              href="/?view=studio"
              className="h-[40px] rounded-[9px] bg-sage hover:bg-sage-hover text-canvas font-medium text-[13.5px] flex items-center justify-center transition-colors no-underline"
            >
              Open MyArtifact Studio →
            </a>
          </div>
        ) : mode === 'cli_authorize' ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2 bg-sunken px-3 py-2 rounded-[8px] border border-line">
              <Terminal className="w-4 h-4 text-sage shrink-0" />
              <span className="truncate">
                Signed in as <strong className="text-ink">{user?.email}</strong>
              </span>
            </div>

            <div className="rounded-[8px] border border-line bg-canvas px-3 py-2 text-[12px] text-ink-2 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-3">Device</span>
                <span className="font-medium text-ink truncate">{deviceLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-3">Callback listener</span>
                <span className="font-mono text-[11.5px] text-ink truncate">
                  {loopbackHostPort || 'Invalid or missing loopback URI'}
                </span>
              </div>
            </div>

            {workspaces.length > 0 && (
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ink-2">
                <span>Default Workspace for Agents</span>
                <select
                  value={selectedWs || workspaces[0].id}
                  onChange={(e) => setSelectedWs(e.target.value)}
                  className="h-[36px] px-2.5 rounded-[8px] bg-canvas border border-line-strong text-[13px] text-ink"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.slug}) · {w.effectiveRole || 'member'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="rounded-[10px] border border-[var(--c-sage-border)] bg-sage-soft/60 p-3.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-sage">
                {elevate ? <Lock className="w-3.5 h-3.5" /> : <ShieldCheck className="w-4 h-4" />}
                <span>
                  {elevate
                    ? 'Elevated CLI Session (24h, Full Role Rights)'
                    : 'Safe Agent Scope Ceiling Enabled'}
                </span>
              </div>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                {elevate
                  ? 'Allows CLI commands including batch sharing and artifact deletion within your RBAC role.'
                  : 'Local CLI & MCP agents (Claude Code, Codex, Antigravity) can read, create, update, and log runs within your RBAC role. Destructive deletes and sharing changes are blocked by default.'}
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-[12px] text-danger-ink bg-danger-soft rounded-[8px] px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {doneMsg ? (
              <div className="flex items-center gap-2 text-[13px] text-sage font-medium bg-sage-soft rounded-[8px] px-3 py-2.5">
                <Check className="w-4 h-4 shrink-0" />
                <span>{doneMsg}</span>
              </div>
            ) : (
              <button
                onClick={handleApproveCli}
                disabled={busy}
                className="h-[40px] rounded-[9px] bg-sage hover:bg-sage-hover disabled:opacity-50 text-canvas font-medium text-[13.5px] transition-colors"
              >
                {busy ? 'Authorizing…' : 'Approve CLI & Coding Agents'}
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleApproveDevice} className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2 bg-sunken px-3 py-2 rounded-[8px] border border-line">
              <Smartphone className="w-4 h-4 text-sage shrink-0" />
              <span>Authorize SSH / Headless CLI Session</span>
            </div>

            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ink-2">
              <span>Device Verification Code</span>
              <input
                type="text"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                placeholder="ABCD-EFGH"
                required
                className="h-[38px] px-3 rounded-[8px] bg-canvas border border-line-strong font-mono text-[15px] tracking-widest uppercase text-ink"
              />
            </label>

            {workspaces.length > 0 && (
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ink-2">
                <span>Default Workspace</span>
                <select
                  value={selectedWs || workspaces[0].id}
                  onChange={(e) => setSelectedWs(e.target.value)}
                  className="h-[36px] px-2.5 rounded-[8px] bg-canvas border border-line-strong text-[13px] text-ink"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.slug})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {error && (
              <div className="flex items-center gap-2 text-[12px] text-danger-ink bg-danger-soft rounded-[8px] px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {doneMsg ? (
              <div className="flex items-center gap-2 text-[13px] text-sage font-medium bg-sage-soft rounded-[8px] px-3 py-2.5">
                <Check className="w-4 h-4 shrink-0" />
                <span>{doneMsg}</span>
              </div>
            ) : (
              <button
                type="submit"
                disabled={busy}
                className="h-[40px] rounded-[9px] bg-sage hover:bg-sage-hover disabled:opacity-50 text-canvas font-medium text-[13.5px] transition-colors"
              >
                {busy ? 'Authorizing…' : 'Authorize Device'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
