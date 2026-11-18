import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { generatePkcePair } from '../cloud/auth/jwt.js';
import { CredentialVault, type StoredCloudCredentials } from './credentials.js';

export interface CliLoginOptions {
  cloudUrl: string;
  dataDir?: string;
  device?: boolean;
  elevate?: boolean;
  workspace?: string;
  noBrowser?: boolean;
  deviceLabel?: string;
  onAuthUrl?: (url: string, userCode?: string) => void | Promise<void>;
}

function tryOpenBrowser(url: string): boolean {
  try {
    const platform = process.platform;
    const cmd =
      platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function loginWithLoopbackPkce(
  options: CliLoginOptions
): Promise<StoredCloudCredentials> {
  const cloudUrl = options.cloudUrl.replace(/\/+$/, '');
  const vault = new CredentialVault(options.dataDir);
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = crypto.randomBytes(18).toString('base64url');
  const deviceLabel = options.deviceLabel || `${os.hostname()} (${process.platform})`;

  let resolveCode!: (value: { code: string; redirectUri: string }) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<{ code: string; redirectUri: string }>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1`);
    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (err || !code || returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Authorization failed or cancelled.</h1><p>You can close this window.</p>');
      rejectCode(new Error(err || 'State mismatch or missing code'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#F7F4ED;color:#1E2420;"><h1>MyArtifact CLI Authorized</h1><p>Your local CLI and coding agents (Claude Code, Codex, Antigravity) are now connected. You may close this tab.</p></body></html>'
    );
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    resolveCode({ code, redirectUri: `http://127.0.0.1:${port}/callback` });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(`${cloudUrl}/auth/cli/authorize`);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('device_label', deviceLabel);
  if (options.elevate) authUrl.searchParams.set('elevate', '1');
  if (options.workspace) authUrl.searchParams.set('workspace', options.workspace);

  console.log(`\n🔐 Open this URL in your browser to sign in with Google and authorize CLI/Agents:`);
  console.log(`   ${authUrl.toString()}\n`);
  await options.onAuthUrl?.(authUrl.toString());
  if (!options.noBrowser) {
    tryOpenBrowser(authUrl.toString());
  }

  const timer = setTimeout(() => {
    rejectCode(new Error('Login timed out waiting for browser authorization'));
  }, 5 * 60_000);

  try {
    const { code } = await codePromise;
    clearTimeout(timer);

    const tokenRes = await fetch(`${cloudUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      throw new Error(`Token exchange failed (${tokenRes.status}): ${txt}`);
    }
    const bundle = (await tokenRes.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      sessionId: string;
      sessionKind: StoredCloudCredentials['sessionKind'];
      scopes: StoredCloudCredentials['scopes'];
      defaultWorkspaceId?: string;
      user: StoredCloudCredentials['user'];
    };

    const creds: StoredCloudCredentials = {
      cloudUrl,
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      expiresAt: new Date(Date.now() + (bundle.expiresIn || 900) * 1000).toISOString(),
      sessionId: bundle.sessionId,
      sessionKind: bundle.sessionKind,
      scopes: bundle.scopes,
      defaultWorkspaceId: options.workspace || bundle.defaultWorkspaceId,
      user: bundle.user,
    };
    vault.writeCredentials(creds);
    const prevCfg = vault.readConfig();
    vault.writeConfig({
      ...prevCfg,
      profile: 'cloud',
      cloudUrl,
      defaultWorkspace: creds.defaultWorkspaceId,
    });
    return creds;
  } finally {
    clearTimeout(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function loginWithDeviceFlow(
  options: CliLoginOptions
): Promise<StoredCloudCredentials> {
  const cloudUrl = options.cloudUrl.replace(/\/+$/, '');
  const vault = new CredentialVault(options.dataDir);
  const deviceLabel = options.deviceLabel || `${os.hostname()} (${process.platform})`;

  const startRes = await fetch(`${cloudUrl}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elevate: Boolean(options.elevate),
      workspace: options.workspace,
      deviceLabel,
    }),
  });
  if (!startRes.ok) {
    throw new Error(`Device auth initialization failed (${startRes.status})`);
  }
  const startData = (await startRes.json()) as {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };

  console.log(`\n📱 Device Authorization Login:`);
  console.log(`   1. Visit: ${startData.verificationUriComplete}`);
  console.log(`   2. Confirm code: ${startData.userCode}\n`);
  await options.onAuthUrl?.(startData.verificationUriComplete, startData.userCode);
  if (!options.noBrowser) {
    tryOpenBrowser(startData.verificationUriComplete);
  }

  const deadline = Date.now() + (startData.expiresIn || 600) * 1000;
  const pollMs = Math.max(1000, (startData.interval || 2) * 1000);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const pollRes = await fetch(`${cloudUrl}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: startData.deviceCode }),
    });
    const body = (await pollRes.json()) as Record<string, unknown>;
    if (pollRes.ok) {
      const creds: StoredCloudCredentials = {
        cloudUrl,
        accessToken: String(body.accessToken),
        refreshToken: String(body.refreshToken),
        expiresAt: new Date(Date.now() + (Number(body.expiresIn) || 900) * 1000).toISOString(),
        sessionId: String(body.sessionId),
        sessionKind: body.sessionKind as StoredCloudCredentials['sessionKind'],
        scopes: body.scopes as StoredCloudCredentials['scopes'],
        defaultWorkspaceId:
          options.workspace ||
          (typeof body.defaultWorkspaceId === 'string' ? body.defaultWorkspaceId : undefined),
        user: body.user as StoredCloudCredentials['user'],
      };
      vault.writeCredentials(creds);
      const prevCfg = vault.readConfig();
      vault.writeConfig({
        ...prevCfg,
        profile: 'cloud',
        cloudUrl,
        defaultWorkspace: creds.defaultWorkspaceId,
      });
      return creds;
    }
    if (body.error === 'authorization_pending') continue;
    throw new Error(`Device authorization failed: ${String(body.error || pollRes.status)}`);
  }

  throw new Error('Device authorization timed out');
}
