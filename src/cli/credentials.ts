import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDefaultDataDir } from '../core/storage.js';
import type { AgentScope, AuthSessionKind, UserProfile } from '../core/types.js';

export interface MyArtifactCliConfig {
  profile: 'local' | 'cloud';
  cloudUrl?: string;
  defaultWorkspace?: string;
}

export interface StoredCloudCredentials {
  cloudUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sessionId: string;
  sessionKind: AuthSessionKind;
  scopes: AgentScope[];
  defaultWorkspaceId?: string;
  user: UserProfile;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class CredentialVault {
  public readonly dataDir: string;
  public readonly configPath: string;
  public readonly credentialsPath: string;
  private readonly lockPath: string;

  constructor(dataDir: string = getDefaultDataDir()) {
    this.dataDir = path.resolve(dataDir);
    this.configPath = path.join(this.dataDir, 'config.json');
    this.credentialsPath = path.join(this.dataDir, 'credentials.json');
    this.lockPath = path.join(this.dataDir, 'credentials.lock');
  }

  public readConfig(): MyArtifactCliConfig {
    if (!fs.existsSync(this.configPath)) {
      return { profile: 'local' };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<MyArtifactCliConfig>;
      return {
        profile: raw.profile === 'cloud' ? 'cloud' : 'local',
        ...(raw.cloudUrl ? { cloudUrl: raw.cloudUrl } : {}),
        ...(raw.defaultWorkspace ? { defaultWorkspace: raw.defaultWorkspace } : {}),
      };
    } catch {
      return { profile: 'local' };
    }
  }

  public writeConfig(config: MyArtifactCliConfig): void {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.configPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.configPath);
  }

  public readCredentials(): StoredCloudCredentials | null {
    if (!fs.existsSync(this.credentialsPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8')) as StoredCloudCredentials;
    } catch {
      return null;
    }
  }

  public writeCredentials(creds: StoredCloudCredentials): void {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.credentialsPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(creds, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, this.credentialsPath);
    try {
      fs.chmodSync(this.credentialsPath, 0o600);
    } catch {
      // Ignore on unsupported FS
    }
  }

  public clearCredentials(): void {
    if (fs.existsSync(this.credentialsPath)) {
      fs.unlinkSync(this.credentialsPath);
    }
  }

  public async withCredentialLock<T>(fn: () => Promise<T>, timeoutMs = 8000): Promise<T> {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + timeoutMs;
    let fd: number | null = null;

    while (fd === null) {
      try {
        fd = fs.openSync(this.lockPath, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'EEXIST') throw err;

        // Check for stale lock
        try {
          const stat = fs.statSync(this.lockPath);
          const lockData = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as {
            pid?: number;
            at?: number;
          };
          const ageMs = Date.now() - (lockData.at || stat.mtimeMs);
          if (ageMs > 15_000 || (lockData.pid && !isPidAlive(lockData.pid))) {
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          // Lock vanished or unreadable; retry
        }

        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for credential refresh lock');
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    try {
      return await fn();
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore
      }
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // Ignore
      }
    }
  }

  public async getValidAccessToken(
    options: { cloudUrl?: string; minValidityMs?: number } = {}
  ): Promise<{ token: string; creds: StoredCloudCredentials | null; refreshed: boolean }> {
    const envToken = process.env.MYARTIFACT_TOKEN;
    if (envToken && envToken.trim()) {
      return { token: envToken.trim(), creds: this.readCredentials(), refreshed: false };
    }

    const minValidityMs = options.minValidityMs ?? 60_000;
    const current = this.readCredentials();
    if (!current) {
      throw new Error('Not logged into MyArtifact Cloud. Run "myartifact login" first.');
    }

    const expMs = Date.parse(current.expiresAt);
    if (Number.isFinite(expMs) && expMs > Date.now() + minValidityMs) {
      return { token: current.accessToken, creds: current, refreshed: false };
    }

    return this.withCredentialLock(async () => {
      // Re-read inside lock in case another concurrent agent already rotated the token!
      const fresh = this.readCredentials();
      if (!fresh) {
        throw new Error('Credentials removed while waiting for refresh lock');
      }
      const freshExp = Date.parse(fresh.expiresAt);
      if (Number.isFinite(freshExp) && freshExp > Date.now() + minValidityMs) {
        return { token: fresh.accessToken, creds: fresh, refreshed: false };
      }

      const targetUrl = (options.cloudUrl || fresh.cloudUrl).replace(/\/+$/, '');
      const res = await fetch(`${targetUrl}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: fresh.refreshToken,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(
          `Session refresh failed (${res.status}): ${txt}. Please run "myartifact login" again.`
        );
      }
      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        sessionId: string;
        sessionKind: AuthSessionKind;
        scopes: AgentScope[];
        defaultWorkspaceId?: string;
        user: UserProfile;
      };

      const nextCreds: StoredCloudCredentials = {
        cloudUrl: targetUrl,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: new Date(Date.now() + (data.expiresIn || 900) * 1000).toISOString(),
        sessionId: data.sessionId || fresh.sessionId,
        sessionKind: data.sessionKind || fresh.sessionKind,
        scopes: data.scopes || fresh.scopes,
        defaultWorkspaceId: data.defaultWorkspaceId || fresh.defaultWorkspaceId,
        user: data.user || fresh.user,
      };
      this.writeCredentials(nextCreds);
      return { token: nextCreds.accessToken, creds: nextCreds, refreshed: true };
    });
  }
}
