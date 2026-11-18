import type { ArtifactStore } from './storage.js';
import type {
  ArtifactDetail,
  ArtifactMetadata,
  CreateArtifactInput,
  ListArtifactsFilter,
  LogScalarsInput,
  ModelCheckpoint,
  SaveModelCheckpointInput,
  StorageEntry,
  UpdateArtifactInput,
  WikiTaxonomy,
} from './types.js';

export interface ArtifactRepository {
  readonly mode: 'local' | 'cloud';
  createArtifact(input: CreateArtifactInput): Promise<ArtifactDetail>;
  updateArtifact(idOrSlug: string, input: UpdateArtifactInput): Promise<ArtifactDetail>;
  upsertBySlug(slug: string, input: CreateArtifactInput): Promise<ArtifactDetail>;
  rollbackArtifact(idOrSlug: string, targetVersion: number, agent?: string): Promise<ArtifactDetail>;
  getArtifact(idOrSlug: string): Promise<ArtifactDetail | null>;
  getVersionContent(idOrSlug: string, version: number): Promise<string | null>;
  listArtifacts(filter?: ListArtifactsFilter): Promise<ArtifactMetadata[]>;
  deleteArtifact(idOrSlug: string): Promise<boolean>;

  getStorageValue(idOrSlug: string, key: string): Promise<{ key: string; value: string } | null>;
  setStorageValue(
    idOrSlug: string,
    key: string,
    value: string
  ): Promise<{ key: string; value: string }>;
  deleteStorageValue(idOrSlug: string, key: string): Promise<{ key: string; deleted: boolean }>;
  listStorageKeys(idOrSlug: string, prefix?: string): Promise<{ keys: string[]; prefix: string }>;
  getAllStorageEntries(idOrSlug: string): Promise<StorageEntry[]>;
  clearStorage(idOrSlug: string): Promise<void>;

  getWikiIndexMarkdown(projectFilter?: string): Promise<string>;
  getWikiLogMarkdown(): Promise<string>;
  getWikiTaxonomy(projectFilter?: string): Promise<WikiTaxonomy>;

  logTensorBoardScalars(input: LogScalarsInput): Promise<ArtifactDetail>;
  saveModelCheckpoint(input: SaveModelCheckpointInput): Promise<{
    artifact: ArtifactDetail;
    checkpoint: ModelCheckpoint;
  }>;
  importTfEventsFile(
    filePath: string,
    options?: { slug?: string; title?: string; agent?: string; project?: string }
  ): Promise<ArtifactDetail>;
  getModelCheckpoints(idOrSlug: string): Promise<ModelCheckpoint[]>;
  getModelCheckpointById(checkpointId: string): Promise<ModelCheckpoint | null>;

  close(): Promise<void>;
}

export class LocalSqliteRepository implements ArtifactRepository {
  public readonly mode = 'local' as const;

  constructor(public readonly store: ArtifactStore) {}

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactDetail> {
    return this.store.createArtifact(input);
  }

  async updateArtifact(idOrSlug: string, input: UpdateArtifactInput): Promise<ArtifactDetail> {
    return this.store.updateArtifact(idOrSlug, input);
  }

  async upsertBySlug(slug: string, input: CreateArtifactInput): Promise<ArtifactDetail> {
    return this.store.upsertBySlug(slug, input);
  }

  async rollbackArtifact(
    idOrSlug: string,
    targetVersion: number,
    agent = 'user'
  ): Promise<ArtifactDetail> {
    return this.store.rollbackArtifact(idOrSlug, targetVersion, agent);
  }

  async getArtifact(idOrSlug: string): Promise<ArtifactDetail | null> {
    return this.store.getArtifact(idOrSlug);
  }

  async getVersionContent(idOrSlug: string, version: number): Promise<string | null> {
    return this.store.getVersionContent(idOrSlug, version);
  }

  async listArtifacts(filter: ListArtifactsFilter = {}): Promise<ArtifactMetadata[]> {
    return this.store.listArtifacts(filter);
  }

  async deleteArtifact(idOrSlug: string): Promise<boolean> {
    return this.store.deleteArtifact(idOrSlug);
  }

  async getStorageValue(
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; value: string } | null> {
    return this.store.getStorageValue(idOrSlug, key);
  }

  async setStorageValue(
    idOrSlug: string,
    key: string,
    value: string
  ): Promise<{ key: string; value: string }> {
    return this.store.setStorageValue(idOrSlug, key, value);
  }

  async deleteStorageValue(
    idOrSlug: string,
    key: string
  ): Promise<{ key: string; deleted: boolean }> {
    return this.store.deleteStorageValue(idOrSlug, key);
  }

  async listStorageKeys(
    idOrSlug: string,
    prefix = ''
  ): Promise<{ keys: string[]; prefix: string }> {
    return this.store.listStorageKeys(idOrSlug, prefix);
  }

  async getAllStorageEntries(idOrSlug: string): Promise<StorageEntry[]> {
    return this.store.getAllStorageEntries(idOrSlug);
  }

  async clearStorage(idOrSlug: string): Promise<void> {
    this.store.clearStorage(idOrSlug);
  }

  async getWikiIndexMarkdown(projectFilter?: string): Promise<string> {
    return this.store.getWikiIndexMarkdown(projectFilter);
  }

  async getWikiLogMarkdown(): Promise<string> {
    return this.store.getWikiLogMarkdown();
  }

  async getWikiTaxonomy(projectFilter?: string): Promise<WikiTaxonomy> {
    return this.store.getWikiTaxonomy(projectFilter);
  }

  async logTensorBoardScalars(input: LogScalarsInput): Promise<ArtifactDetail> {
    return this.store.logTensorBoardScalars(input);
  }

  async saveModelCheckpoint(input: SaveModelCheckpointInput): Promise<{
    artifact: ArtifactDetail;
    checkpoint: ModelCheckpoint;
  }> {
    return this.store.saveModelCheckpoint(input);
  }

  async importTfEventsFile(
    filePath: string,
    options?: { slug?: string; title?: string; agent?: string; project?: string }
  ): Promise<ArtifactDetail> {
    return this.store.importTfEventsFile(filePath, options);
  }

  async getModelCheckpoints(idOrSlug: string): Promise<ModelCheckpoint[]> {
    return this.store.getModelCheckpoints(idOrSlug);
  }

  async getModelCheckpointById(checkpointId: string): Promise<ModelCheckpoint | null> {
    return this.store.getModelCheckpointById(checkpointId);
  }

  async close(): Promise<void> {
    this.store.close();
  }
}
