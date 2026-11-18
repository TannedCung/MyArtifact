import type { ArtifactRepository } from './repository.js';
import { LocalSqliteRepository } from './repository.js';
import { ArtifactStore, getDefaultDataDir } from './storage.js';
import { CredentialVault } from '../cli/credentials.js';
import { CloudHttpRepository } from '../client/cloud-repository.js';

export interface ResolveRepositoryOptions {
  dataDir?: string;
  profile?: 'local' | 'cloud';
  cloudUrl?: string;
  workspace?: string;
  agent?: string;
}

export function resolveRepository(options: ResolveRepositoryOptions = {}): ArtifactRepository {
  const dataDir = options.dataDir || getDefaultDataDir();
  const vault = new CredentialVault(dataDir);
  const cfg = vault.readConfig();
  const creds = vault.readCredentials();

  const envProfile = process.env.MYARTIFACT_PROFILE;
  const activeProfile =
    options.profile ||
    (envProfile === 'cloud' || envProfile === 'local' ? envProfile : undefined) ||
    (options.cloudUrl || process.env.MYARTIFACT_CLOUD_URL ? 'cloud' : undefined) ||
    cfg.profile;

  if (activeProfile === 'cloud') {
    const cloudUrl =
      options.cloudUrl ||
      process.env.MYARTIFACT_CLOUD_URL ||
      cfg.cloudUrl ||
      creds?.cloudUrl;
    if (cloudUrl) {
      return new CloudHttpRepository({
        cloudUrl,
        vault,
        workspace:
          options.workspace ||
          process.env.MYARTIFACT_WORKSPACE ||
          cfg.defaultWorkspace ||
          creds?.defaultWorkspaceId,
        agent: options.agent || process.env.MYARTIFACT_AGENT || 'cli',
      });
    }
  }

  return new LocalSqliteRepository(new ArtifactStore(dataDir));
}
