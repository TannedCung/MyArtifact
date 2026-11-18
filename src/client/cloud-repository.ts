import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactRepository } from '../core/repository.js';
import type { ArtifactStore } from '../core/storage.js';
import { parseTfEventsBuffer } from '../core/tensorboard.js';
import type {
  ArtifactDetail,
  ArtifactMetadata,
  BatchRevokeRequest,
  BatchShareRequest,
  BatchShareResult,
  CreateArtifactInput,
  EffectiveAclDetail,
  ListArtifactsFilter,
  LogScalarsInput,
  ModelCheckpoint,
  ResourceType,
  SaveModelCheckpointInput,
  ShareLink,
  ShareLinkTargetSpec,
  StorageEntry,
  UpdateArtifactInput,
  WikiTaxonomy,
  Workspace,
  WorkspaceGroup,
} from '../core/types.js';
import type { CredentialVault } from '../cli/credentials.js';

export interface CloudHttpClientOptions {
  cloudUrl: string;
  vault: CredentialVault;
  workspace?: string;
  agent?: string;
}

export class CloudHttpRepository implements ArtifactRepository {
  public readonly mode = 'cloud' as const;
  public readonly cloudUrl: string;
  private readonly vault: CredentialVault;
  private workspace?: string;
  private readonly agent: string;

  constructor(options: CloudHttpClientOptions) {
    this.cloudUrl = options.cloudUrl.replace(/\/+$/, '');
    this.vault = options.vault;
    this.workspace = options.workspace;
    this.agent = options.agent || process.env.MYARTIFACT_AGENT || 'cli';
  }

  public setWorkspace(ws: string): void {
    this.workspace = ws;
  }

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    const { token, creds } = await this.vault.getValidAccessToken({ cloudUrl: this.cloudUrl });
    const ws = this.workspace || creds?.defaultWorkspaceId;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-MyArtifact-Agent': this.agent,
      ...(ws ? { 'X-MyArtifact-Workspace': ws } : {}),
      ...extraHeaders,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.cloudUrl}${apiPath}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { error: text };
    }

    if (!res.ok) {
      const code = parsed.code ? ` [${parsed.code}]` : '';
      const err = new Error(String(parsed.error || `HTTP ${res.status}`) + code);
      (err as Error & { statusCode?: number; code?: string }).statusCode = res.status;
      (err as Error & { statusCode?: number; code?: string }).code =
        typeof parsed.code === 'string' ? parsed.code : undefined;
      throw err;
    }
    return parsed as unknown as T;
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactDetail> {
    const res = await this.request<{ artifact: ArtifactDetail }>('POST', '/api/artifacts', {
      ...input,
      agent: input.agent || this.agent,
    });
    return res.artifact;
  }

  async updateArtifact(idOrSlug: string, input: UpdateArtifactInput): Promise<ArtifactDetail> {
    const res = await this.request<{ artifact: ArtifactDetail }>(
      'PUT',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}`,
      { ...input, agent: input.agent || this.agent }
    );
    return res.artifact;
  }

  async upsertBySlug(slug: string, input: CreateArtifactInput): Promise<ArtifactDetail> {
    const res = await this.request<{ artifact: ArtifactDetail }>('POST', '/api/artifacts', {
      ...input,
      slug,
      upsert: true,
      agent: input.agent || this.agent,
    });
    return res.artifact;
  }

  async rollbackArtifact(
    idOrSlug: string,
    targetVersion: number,
    agent?: string
  ): Promise<ArtifactDetail> {
    const res = await this.request<{ artifact: ArtifactDetail }>(
      'POST',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}/rollback`,
      { version: targetVersion, agent: agent || this.agent }
    );
    return res.artifact;
  }

  async getArtifact(idOrSlug: string): Promise<ArtifactDetail | null> {
    try {
      const res = await this.request<{ artifact: ArtifactDetail }>(
        'GET',
        `/api/artifacts/${encodeURIComponent(idOrSlug)}`
      );
      return res.artifact;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async getVersionContent(idOrSlug: string, version: number): Promise<string | null> {
    try {
      const res = await this.request<{ content: string }>(
        'GET',
        `/api/artifacts/${encodeURIComponent(idOrSlug)}/versions/${version}`
      );
      return res.content;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async listArtifacts(filter: ListArtifactsFilter = {}): Promise<ArtifactMetadata[]> {
    const qs = new URLSearchParams();
    if (filter.query) qs.set('q', filter.query);
    if (filter.agent) qs.set('agent', filter.agent);
    if (filter.type) qs.set('type', filter.type);
    if (filter.project) qs.set('project', filter.project);
    if (filter.category) qs.set('category', filter.category);
    if (filter.tag) qs.set('tag', filter.tag);
    if (filter.limit) qs.set('limit', String(filter.limit));
    const qStr = qs.toString();
    const res = await this.request<{ artifacts: ArtifactMetadata[] }>(
      'GET',
      `/api/artifacts${qStr ? `?${qStr}` : ''}`
    );
    return res.artifacts;
  }

  async deleteArtifact(idOrSlug: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/api/artifacts/${encodeURIComponent(idOrSlug)}`);
      return true;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return false;
      throw err;
    }
  }

  async getStorageValue(
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; value: string } | null> {
    const res = await this.request<{ result: { key: string; value: string } | null }>(
      'GET',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}/storage?key=${encodeURIComponent(key)}`
    );
    return res.result;
  }

  async setStorageValue(
    idOrSlug: string,
    key: string,
    value: string
  ): Promise<{ key: string; value: string }> {
    const res = await this.request<{ result: { key: string; value: string } }>(
      'PUT',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}/storage`,
      { key, value }
    );
    return res.result;
  }

  async deleteStorageValue(
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; deleted: boolean }> {
    const res = await this.request<{ result: { key: string; deleted: boolean } }>(
      'DELETE',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}/storage?key=${encodeURIComponent(key)}`
    );
    return res.result;
  }

  async listStorageKeys(
    idOrSlug: string,
    prefix = ''
  ): Promise<{ keys: string[]; prefix: string }> {
    const res = await this.request<{ result: { keys: string[]; prefix: string } }>(
      'GET',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}/storage?prefix=${encodeURIComponent(prefix)}`
    );
    return res.result;
  }

  async getAllStorageEntries(idOrSlug: string): Promise<StorageEntry[]> {
    const res = await this.request<{ entries: StorageEntry[] }>(
      'GET',
      `/api/artifacts/${encodeURIComponent(idOrSlug)}/storage`
    );
    return res.entries;
  }

  async clearStorage(idOrSlug: string): Promise<void> {
    await this.request('DELETE', `/api/artifacts/${encodeURIComponent(idOrSlug)}/storage`);
  }

  private async fetchWiki(projectFilter?: string) {
    const qs =
      projectFilter && projectFilter !== 'all'
        ? `?project=${encodeURIComponent(projectFilter)}`
        : '';
    return this.request<WikiTaxonomy & { indexMarkdown: string; logMarkdown: string }>(
      'GET',
      `/api/wiki${qs}`
    );
  }

  async getWikiIndexMarkdown(projectFilter?: string): Promise<string> {
    return (await this.fetchWiki(projectFilter)).indexMarkdown;
  }

  async getWikiLogMarkdown(): Promise<string> {
    return (await this.fetchWiki()).logMarkdown;
  }

  async getWikiTaxonomy(projectFilter?: string): Promise<WikiTaxonomy> {
    const w = await this.fetchWiki(projectFilter);
    return {
      projects: w.projects,
      categories: w.categories,
      backlinks: w.backlinks,
    };
  }

  async logTensorBoardScalars(input: LogScalarsInput): Promise<ArtifactDetail> {
    const res = await this.request<{ artifact: ArtifactDetail }>(
      'POST',
      `/api/tensorboard/runs/${encodeURIComponent(input.slug)}/scalars`,
      input
    );
    return res.artifact;
  }

  async saveModelCheckpoint(input: SaveModelCheckpointInput): Promise<{
    artifact: ArtifactDetail;
    checkpoint: ModelCheckpoint;
  }> {
    let payload: Buffer;
    const rawName =
      input.name ||
      (input.sourceFilePath
        ? path.basename(input.sourceFilePath)
        : `checkpoint-step-${input.step ?? 0}.${input.format || 'safetensors'}`);

    if (input.sourceFilePath && fs.existsSync(input.sourceFilePath)) {
      payload = fs.readFileSync(input.sourceFilePath);
    } else if (input.content !== undefined) {
      payload = Buffer.isBuffer(input.content)
        ? input.content
        : Buffer.from(String(input.content), 'utf8');
    } else {
      payload = Buffer.from(
        JSON.stringify({
          runSlug: input.slug,
          name: rawName,
          step: input.step ?? 0,
          metrics: input.metrics || {},
        }),
        'utf8'
      );
    }

    const presign = await this.request<{
      checkpointId: string;
      objectKey: string;
      uploadUrl: string;
      method: 'PUT';
      headers: Record<string, string>;
    }>(
      'POST',
      `/api/tensorboard/runs/${encodeURIComponent(input.slug)}/checkpoints:presign`,
      { name: rawName }
    );

    const putRes = await fetch(presign.uploadUrl, {
      method: presign.method || 'PUT',
      headers: presign.headers || { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(payload),
    });
    if (!putRes.ok) {
      throw new Error(`Presigned checkpoint upload failed (${putRes.status})`);
    }

    return this.request<{ artifact: ArtifactDetail; checkpoint: ModelCheckpoint }>(
      'POST',
      `/api/tensorboard/runs/${encodeURIComponent(input.slug)}/checkpoints:finalize`,
      {
        checkpointId: presign.checkpointId,
        objectKey: presign.objectKey,
        name: rawName,
        step: input.step,
        epoch: input.epoch,
        format: input.format,
        metrics: input.metrics,
        metadata: input.metadata,
        isBest: input.isBest,
        agent: input.agent || this.agent,
        summary: input.summary,
      }
    );
  }

  async importTfEventsFile(
    filePath: string,
    options: { slug?: string; title?: string; agent?: string; project?: string } = {}
  ): Promise<ArtifactDetail> {
    const resolved = path.resolve(filePath);
    const scalars = parseTfEventsBuffer(fs.readFileSync(resolved));
    const slug =
      options.slug ||
      path.basename(resolved).replace(/\.tfevents.*$/, '').replace(/[^a-z0-9-]+/gi, '-') ||
      'tb-run';
    return this.logTensorBoardScalars({
      slug,
      title: options.title,
      agent: options.agent || this.agent,
      project: options.project || 'training',
      scalars,
      summary: `Imported ${scalars.length} scalar events from ${path.basename(resolved)}`,
    });
  }

  async getModelCheckpoints(idOrSlug: string): Promise<ModelCheckpoint[]> {
    const res = await this.request<{ checkpoints: ModelCheckpoint[] }>(
      'GET',
      `/api/tensorboard/runs/${encodeURIComponent(idOrSlug)}/checkpoints`
    );
    return res.checkpoints;
  }

  async getModelCheckpointById(): Promise<ModelCheckpoint | null> {
    return null;
  }

  // Cloud IAM & Workspace Operations
  async listWorkspaces(): Promise<Workspace[]> {
    const res = await this.request<{ workspaces: Workspace[] }>('GET', '/api/workspaces');
    return res.workspaces;
  }

  async createWorkspace(name: string, slug?: string, allowedGoogleHd?: string): Promise<Workspace> {
    const res = await this.request<{ workspace: Workspace }>('POST', '/api/workspaces', {
      name,
      slug,
      allowedGoogleHd,
    });
    return res.workspace;
  }

  async listGroups(workspaceRef?: string): Promise<WorkspaceGroup[]> {
    const ws = await this.requireWorkspaceRef(workspaceRef);
    const res = await this.request<{ groups: WorkspaceGroup[] }>(
      'GET',
      `/api/workspaces/${encodeURIComponent(ws)}/groups`
    );
    return res.groups;
  }

  async createGroup(
    input: { name: string; slug?: string; memberEmails?: string[] },
    workspaceRef?: string
  ): Promise<WorkspaceGroup> {
    const ws = await this.requireWorkspaceRef(workspaceRef);
    const res = await this.request<{ group: WorkspaceGroup }>(
      'POST',
      `/api/workspaces/${encodeURIComponent(ws)}/groups`,
      input
    );
    return res.group;
  }

  async shareBatch(req: BatchShareRequest, workspaceRef?: string): Promise<BatchShareResult> {
    const ws = await this.requireWorkspaceRef(workspaceRef);
    return this.request<BatchShareResult>(
      'POST',
      `/api/workspaces/${encodeURIComponent(ws)}/iam/grants:batch`,
      req
    );
  }

  async revokeBatch(
    req: BatchRevokeRequest,
    workspaceRef?: string
  ): Promise<{ revokedCount: number }> {
    const ws = await this.requireWorkspaceRef(workspaceRef);
    return this.request<{ revokedCount: number }>(
      'POST',
      `/api/workspaces/${encodeURIComponent(ws)}/iam/grants:revoke-batch`,
      req
    );
  }

  async createShareLink(
    input: {
      accessMode: 'anyone' | 'domain';
      requiredHd?: string;
      role: 'viewer' | 'editor';
      targetSpec: ShareLinkTargetSpec;
      label?: string;
      expiresAt?: string;
    },
    workspaceRef?: string
  ): Promise<{ link: ShareLink; token: string; shareUrl: string }> {
    const ws = await this.requireWorkspaceRef(workspaceRef);
    return this.request<{ link: ShareLink; token: string; shareUrl: string }>(
      'POST',
      `/api/workspaces/${encodeURIComponent(ws)}/iam/share-links`,
      input
    );
  }

  async getResourceAcl(
    resourceType: ResourceType,
    resourceKey: string,
    workspaceRef?: string
  ): Promise<EffectiveAclDetail> {
    const ws = await this.requireWorkspaceRef(workspaceRef);
    return this.request<EffectiveAclDetail>(
      'GET',
      `/api/workspaces/${encodeURIComponent(ws)}/iam/acl?resourceType=${encodeURIComponent(
        resourceType
      )}&resourceKey=${encodeURIComponent(resourceKey)}`
    );
  }

  private async requireWorkspaceRef(workspaceRef?: string): Promise<string> {
    if (workspaceRef) return workspaceRef;
    if (this.workspace) return this.workspace;
    const { creds } = await this.vault.getValidAccessToken({ cloudUrl: this.cloudUrl });
    if (creds?.defaultWorkspaceId) return creds.defaultWorkspaceId;
    const list = await this.listWorkspaces();
    if (list[0]) return list[0].id;
    throw new Error('No cloud workspace found');
  }

  async migrateFromLocalStore(localStore: ArtifactStore): Promise<{
    artifactsMigrated: number;
    versionsMigrated: number;
    storageKeysMigrated: number;
    checkpointsMigrated: number;
  }> {
    const all = localStore.listArtifacts({ limit: 1000 });
    let artifactsMigrated = 0;
    let versionsMigrated = 0;
    let storageKeysMigrated = 0;
    let checkpointsMigrated = 0;

    for (const meta of all) {
      const detail = localStore.getArtifact(meta.id);
      if (!detail) continue;

      const versions = [...detail.versions].sort((a, b) => a.version - b.version);
      if (versions.length === 0) continue;

      for (let i = 0; i < versions.length; i++) {
        const ver = versions[i];
        const verContent = localStore.getVersionContent(detail.id, ver.version);
        if (verContent === null) continue;
        await this.upsertBySlug(detail.slug, {
          slug: detail.slug,
          title: detail.title,
          description: detail.description,
          type: detail.type,
          language: detail.language,
          content: verContent,
          agent: ver.agent || detail.agent,
          project: detail.project,
          category: detail.category,
          tags: detail.tags,
          links: detail.links,
          icon: detail.icon,
          summary: ver.summary || `Migrated v${ver.version}`,
        });
        versionsMigrated++;
      }

      const entries = localStore.getAllStorageEntries(detail.id);
      for (const entry of entries) {
        await this.setStorageValue(detail.slug, entry.key, entry.value);
        storageKeysMigrated++;
      }

      if (detail.type === 'tensorboard') {
        const ckpts = localStore.getModelCheckpoints(detail.id);
        for (const ck of ckpts) {
          if (fs.existsSync(ck.filePath)) {
            await this.saveModelCheckpoint({
              slug: detail.slug,
              name: ck.name,
              step: ck.step,
              epoch: ck.epoch,
              sourceFilePath: ck.filePath,
              format: ck.format,
              metrics: ck.metrics,
              metadata: ck.metadata,
              isBest: ck.isBest,
              agent: detail.agent,
              summary: `Migrated checkpoint ${ck.name}`,
            });
            checkpointsMigrated++;
          }
        }
      }

      artifactsMigrated++;
    }

    return {
      artifactsMigrated,
      versionsMigrated,
      storageKeysMigrated,
      checkpointsMigrated,
    };
  }

  async close(): Promise<void> {
    // Stateless HTTP client
  }
}
