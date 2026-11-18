import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface PresignedTransfer {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface BlobStore {
  readonly kind: 'local' | 's3' | 'postgres';
  putCasText(text: string): Promise<{ sha256: string; byteSize: number; key: string }>;
  getCasText(sha256: string): Promise<string | null>;
  putObject(
    key: string,
    data: Buffer | string,
    contentType?: string
  ): Promise<{ key: string; sha256: string; byteSize: number }>;
  getObjectBuffer(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  createPresignedUpload(
    key: string,
    expiresInSeconds?: number,
    contentType?: string
  ): Promise<PresignedTransfer>;
  createPresignedDownload(
    key: string,
    filename?: string,
    expiresInSeconds?: number
  ): Promise<PresignedTransfer>;
}

export interface SignedLocalTransferStore extends BlobStore {
  setBaseUrl(baseUrl: string): void;
  verifySignedLocalToken(
    action: 'upload' | 'download',
    key: string,
    expMs: number,
    sig: string
  ): boolean;
}

export function isSignedLocalTransferStore(store: BlobStore): store is SignedLocalTransferStore {
  return (
    typeof (store as Partial<SignedLocalTransferStore>).setBaseUrl === 'function' &&
    typeof (store as Partial<SignedLocalTransferStore>).verifySignedLocalToken === 'function'
  );
}

interface PostgresBlobPoolLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function sanitizeContentDispositionFilename(raw: string): string {
  return raw.replace(/[\r\n"\\/\x00-\x1f\x7f]/g, '').trim() || 'download';
}

function normalizeObjectKey(rawKey: string): string {
  if (typeof rawKey !== 'string' || !rawKey || rawKey.includes('\0')) {
    throw new Error('Invalid object key');
  }
  const rawSegments = rawKey.split(/[\\/]/);
  for (const seg of rawSegments) {
    if (seg === '..') {
      throw new Error('Invalid object key');
    }
  }
  const segments = rawSegments.filter((s) => s && s !== '.');
  if (segments.length === 0) {
    throw new Error('Invalid object key');
  }
  return segments.join('/');
}

export function casKeyForSha256(sha256: string): string {
  const clean = sha256.toLowerCase().replace(/[^a-f0-9]/g, '');
  if (clean.length !== 64) {
    throw new Error(`Invalid SHA-256 hex digest: ${sha256}`);
  }
  return `cas/sha256/${clean.slice(0, 2)}/${clean}`;
}

abstract class BaseSignedLocalBlobStore implements SignedLocalTransferStore {
  public abstract readonly kind: 'local' | 'postgres';
  private readonly signingSecret: string;
  private baseUrl = 'http://127.0.0.1:4173';

  constructor(options: { signingSecret?: string; baseUrl?: string } = {}) {
    this.signingSecret =
      options.signingSecret ||
      process.env.MYARTIFACT_BLOB_SECRET ||
      process.env.MYARTIFACT_SECRET ||
      process.env.MYARTIFACT_COOKIE_SECRET ||
      crypto.randomBytes(32).toString('hex');
    if (options.baseUrl) {
      this.setBaseUrl(options.baseUrl);
    }
  }

  public setBaseUrl(baseUrl: string): void {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid blob store baseUrl protocol');
    }
    this.baseUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  }

  private signLocalUrl(action: 'upload' | 'download', key: string, expMs: number): string {
    return crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${action}:${key}:${expMs}`)
      .digest('base64url');
  }

  public verifySignedLocalToken(
    action: 'upload' | 'download',
    key: string,
    expMs: number,
    sig: string
  ): boolean {
    if (!Number.isFinite(expMs) || Date.now() > expMs) return false;
    const expected = this.signLocalUrl(action, key, expMs);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sig || '', 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  async createPresignedUpload(
    key: string,
    expiresInSeconds = 900,
    contentType = 'application/octet-stream'
  ): Promise<PresignedTransfer> {
    const safeKey = normalizeObjectKey(key);
    const expMs = Date.now() + expiresInSeconds * 1000;
    const sig = this.signLocalUrl('upload', safeKey, expMs);
    const url = `${this.baseUrl}/api/blobs/upload?key=${encodeURIComponent(safeKey)}&exp=${expMs}&sig=${encodeURIComponent(sig)}`;
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(expMs).toISOString(),
    };
  }

  async createPresignedDownload(
    key: string,
    filename?: string,
    expiresInSeconds = 900
  ): Promise<PresignedTransfer> {
    const safeKey = normalizeObjectKey(key);
    const expMs = Date.now() + expiresInSeconds * 1000;
    const sig = this.signLocalUrl('download', safeKey, expMs);
    const safeFn = filename ? sanitizeContentDispositionFilename(filename) : '';
    const fnPart = safeFn ? `&fn=${encodeURIComponent(safeFn)}` : '';
    const url = `${this.baseUrl}/api/blobs/download?key=${encodeURIComponent(safeKey)}&exp=${expMs}&sig=${encodeURIComponent(sig)}${fnPart}`;
    return {
      url,
      method: 'GET',
      headers: {},
      expiresAt: new Date(expMs).toISOString(),
    };
  }

  abstract putCasText(text: string): Promise<{ sha256: string; byteSize: number; key: string }>;
  abstract getCasText(sha256: string): Promise<string | null>;
  abstract putObject(
    key: string,
    data: Buffer | string,
    contentType?: string
  ): Promise<{ key: string; sha256: string; byteSize: number }>;
  abstract getObjectBuffer(key: string): Promise<Buffer | null>;
  abstract deleteObject(key: string): Promise<void>;
}

export class LocalDiskBlobStore extends BaseSignedLocalBlobStore {
  public readonly kind = 'local' as const;
  private readonly casDir: string;
  private readonly objectsDir: string;

  constructor(
    public readonly rootDir: string,
    options: { signingSecret?: string; baseUrl?: string } = {}
  ) {
    super(options);
    this.rootDir = path.resolve(rootDir);
    this.casDir = path.join(this.rootDir, 'cas', 'sha256');
    this.objectsDir = path.join(this.rootDir, 'objects');
    fs.mkdirSync(this.casDir, { recursive: true });
    fs.mkdirSync(this.objectsDir, { recursive: true });
  }

  private resolveObjectPath(key: string): string {
    const safeKey = normalizeObjectKey(key);
    const resolved = path.resolve(this.objectsDir, ...safeKey.split('/'));
    if (!resolved.startsWith(this.objectsDir + path.sep) && resolved !== this.objectsDir) {
      throw new Error('Object key escapes blob root');
    }
    return resolved;
  }

  async putCasText(text: string): Promise<{ sha256: string; byteSize: number; key: string }> {
    const buf = Buffer.from(text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const key = casKeyForSha256(sha256);
    const targetDir = path.join(this.casDir, sha256.slice(0, 2));
    const targetPath = path.join(targetDir, sha256);
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, buf);
    }
    return { sha256, byteSize: buf.byteLength, key };
  }

  async getCasText(sha256: string): Promise<string | null> {
    const clean = sha256.toLowerCase().replace(/[^a-f0-9]/g, '');
    if (clean.length !== 64) return null;
    const targetPath = path.join(this.casDir, clean.slice(0, 2), clean);
    if (!fs.existsSync(targetPath)) return null;
    return fs.readFileSync(targetPath, 'utf8');
  }

  async putObject(
    key: string,
    data: Buffer | string
  ): Promise<{ key: string; sha256: string; byteSize: number }> {
    const safeKey = normalizeObjectKey(key);
    const targetPath = this.resolveObjectPath(safeKey);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buf);
    return { key: safeKey, sha256, byteSize: buf.byteLength };
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    const targetPath = this.resolveObjectPath(key);
    if (!fs.existsSync(targetPath)) return null;
    return fs.readFileSync(targetPath);
  }

  async deleteObject(key: string): Promise<void> {
    const targetPath = this.resolveObjectPath(key);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }
}

/**
 * Durable Bytea-backed blob store inside PostgreSQL for serverless deployments
 * (e.g. Vercel Hobby + Neon Free) when external S3/Cloudflare R2 is omitted.
 */
export class PostgresBlobStore extends BaseSignedLocalBlobStore {
  public readonly kind = 'postgres' as const;

  constructor(
    private readonly pool: PostgresBlobPoolLike,
    options: { signingSecret?: string; baseUrl?: string } = {}
  ) {
    super(options);
  }

  async putCasText(text: string): Promise<{ sha256: string; byteSize: number; key: string }> {
    const buf = Buffer.from(text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const key = casKeyForSha256(sha256);
    await this.pool.query(
      `INSERT INTO cloud_blobs (key, sha256, byte_size, content_type, data)
       VALUES ($1, $2, $3, 'text/plain; charset=utf-8', $4)
       ON CONFLICT (key) DO NOTHING`,
      [key, sha256, buf.byteLength, buf]
    );
    return { sha256, byteSize: buf.byteLength, key };
  }

  async getCasText(sha256: string): Promise<string | null> {
    const clean = sha256.toLowerCase().replace(/[^a-f0-9]/g, '');
    if (clean.length !== 64) return null;
    const key = casKeyForSha256(clean);
    const res = await this.pool.query<{ data: Buffer | Uint8Array | string }>(
      'SELECT data FROM cloud_blobs WHERE key = $1',
      [key]
    );
    const raw = res.rows[0]?.data;
    if (raw === undefined || raw === null) return null;
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8');
    return String(raw);
  }

  async putObject(
    key: string,
    data: Buffer | string,
    contentType = 'application/octet-stream'
  ): Promise<{ key: string; sha256: string; byteSize: number }> {
    const safeKey = normalizeObjectKey(key);
    const dbKey = `objects/${safeKey}`;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    await this.pool.query(
      `INSERT INTO cloud_blobs (key, sha256, byte_size, content_type, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET
         sha256 = EXCLUDED.sha256,
         byte_size = EXCLUDED.byte_size,
         content_type = EXCLUDED.content_type,
         data = EXCLUDED.data,
         created_at = NOW()`,
      [dbKey, sha256, buf.byteLength, contentType, buf]
    );
    return { key: safeKey, sha256, byteSize: buf.byteLength };
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    const safeKey = normalizeObjectKey(key);
    const res = await this.pool.query<{ data: Buffer | Uint8Array | string }>(
      'SELECT data FROM cloud_blobs WHERE key = $1',
      [`objects/${safeKey}`]
    );
    const raw = res.rows[0]?.data;
    if (raw === undefined || raw === null) return null;
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    return Buffer.from(String(raw), 'utf8');
  }

  async deleteObject(key: string): Promise<void> {
    const safeKey = normalizeObjectKey(key);
    await this.pool.query('DELETE FROM cloud_blobs WHERE key = $1', [`objects/${safeKey}`]);
  }
}

export interface S3BlobStoreConfig {
  endpoint: string; // e.g. https://s3.us-east-1.amazonaws.com, https://storage.googleapis.com, http://127.0.0.1:9000
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  publicEndpoint?: string; // Optional browser-reachable endpoint if internal endpoint differs
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Pure Node.js AWS SigV4 client & presigner compatible with AWS S3, GCS S3-interop,
 * Cloudflare R2, and MinIO without external SDK bloat.
 */
export class S3CompatibleBlobStore implements BlobStore {
  public readonly kind = 's3' as const;
  private readonly forcePathStyle: boolean;

  constructor(private readonly cfg: S3BlobStoreConfig) {
    this.forcePathStyle = cfg.forcePathStyle ?? true;
  }

  private buildObjectEndpoint(
    key: string,
    usePublicEndpoint = false
  ): { origin: string; hostHeader: string; canonicalPath: string } {
    const safeKey = normalizeObjectKey(key);
    const rawBase =
      usePublicEndpoint && this.cfg.publicEndpoint
        ? this.cfg.publicEndpoint
        : this.cfg.endpoint;
    const baseUrl = new URL(rawBase);
    const encodedKeyPath = safeKey.split('/').map(encodeRfc3986).join('/');
    const basePrefix = baseUrl.pathname.replace(/\/+$/, '');

    if (this.forcePathStyle) {
      return {
        origin: baseUrl.origin,
        hostHeader: baseUrl.host,
        canonicalPath: `${basePrefix}/${encodeRfc3986(this.cfg.bucket)}/${encodedKeyPath}`,
      };
    }

    const vhost = `${this.cfg.bucket}.${baseUrl.host}`;
    return {
      origin: `${baseUrl.protocol}//${vhost}`,
      hostHeader: vhost,
      canonicalPath: `${basePrefix}/${encodedKeyPath}`,
    };
  }

  private getSigningKey(dateStamp: string): Buffer {
    const kDate = hmacSha256(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.cfg.region);
    const kService = hmacSha256(kRegion, 's3');
    return hmacSha256(kService, 'aws4_request');
  }

  private signHeaders(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    key: string,
    payload: Buffer | string = '',
    extraHeaders: Record<string, string> = {}
  ): { url: string; headers: Record<string, string> } {
    const { origin, hostHeader, canonicalPath } = this.buildObjectEndpoint(key, false);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);

    const lowerHeaders: Record<string, string> = {
      host: hostHeader,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    for (const [k, v] of Object.entries(extraHeaders)) {
      lowerHeaders[k.toLowerCase()] = v.trim();
    }

    const signedKeys = Object.keys(lowerHeaders).sort();
    const canonicalHeaders = signedKeys.map((k) => `${k}:${lowerHeaders[k]}\n`).join('');
    const signedHeaders = signedKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalPath,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signature = crypto
      .createHmac('sha256', this.getSigningKey(dateStamp))
      .update(stringToSign, 'utf8')
      .digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const finalHeaders: Record<string, string> = {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: authorization,
      ...extraHeaders,
    };

    return { url: `${origin}${canonicalPath}`, headers: finalHeaders };
  }

  private presignUrl(
    method: 'GET' | 'PUT',
    key: string,
    expiresInSeconds: number,
    extraQuery: Record<string, string> = {}
  ): { url: string; expiresAt: string } {
    const { origin, hostHeader, canonicalPath } = this.buildObjectEndpoint(key, true);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.cfg.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(Math.max(1, Math.min(604800, expiresInSeconds))),
      'X-Amz-SignedHeaders': 'host',
      ...extraQuery,
    };

    const canonicalQuery = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
      .join('&');

    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery,
      `host:${hostHeader}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signature = crypto
      .createHmac('sha256', this.getSigningKey(dateStamp))
      .update(stringToSign, 'utf8')
      .digest('hex');

    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
    return {
      url: `${origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`,
      expiresAt,
    };
  }

  async putCasText(text: string): Promise<{ sha256: string; byteSize: number; key: string }> {
    const buf = Buffer.from(text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const key = casKeyForSha256(sha256);
    await this.putObject(key, buf, 'text/plain; charset=utf-8');
    return { sha256, byteSize: buf.byteLength, key };
  }

  async getCasText(sha256: string): Promise<string | null> {
    const buf = await this.getObjectBuffer(casKeyForSha256(sha256));
    return buf ? buf.toString('utf8') : null;
  }

  async putObject(
    key: string,
    data: Buffer | string,
    contentType = 'application/octet-stream'
  ): Promise<{ key: string; sha256: string; byteSize: number }> {
    const safeKey = normalizeObjectKey(key);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const signed = this.signHeaders('PUT', safeKey, buf, { 'Content-Type': contentType });
    const res = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: new Uint8Array(buf),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`S3 PUT failed (${res.status}): ${errBody}`);
    }
    return { key: safeKey, sha256, byteSize: buf.byteLength };
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    const signed = this.signHeaders('GET', key);
    const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`S3 GET failed (${res.status}): ${errBody}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const signed = this.signHeaders('DELETE', key);
    const res = await fetch(signed.url, { method: 'DELETE', headers: signed.headers });
    if (!res.ok && res.status !== 404) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`S3 DELETE failed (${res.status}): ${errBody}`);
    }
  }

  async createPresignedUpload(
    key: string,
    expiresInSeconds = 900,
    contentType = 'application/octet-stream'
  ): Promise<PresignedTransfer> {
    const { url, expiresAt } = this.presignUrl('PUT', key, expiresInSeconds);
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt,
    };
  }

  async createPresignedDownload(
    key: string,
    filename?: string,
    expiresInSeconds = 900
  ): Promise<PresignedTransfer> {
    const extra: Record<string, string> = {};
    if (filename) {
      extra['response-content-disposition'] = `attachment; filename="${sanitizeContentDispositionFilename(filename)}"`;
    }
    const { url, expiresAt } = this.presignUrl('GET', key, expiresInSeconds, extra);
    return {
      url,
      method: 'GET',
      headers: {},
      expiresAt,
    };
  }
}

export function hasS3EnvConfig(): boolean {
  return Boolean(
    process.env.MYARTIFACT_S3_ENDPOINT &&
      process.env.MYARTIFACT_S3_BUCKET &&
      process.env.MYARTIFACT_S3_ACCESS_KEY &&
      process.env.MYARTIFACT_S3_SECRET_KEY
  );
}

export function createBlobStoreFromEnv(dataDir: string): BlobStore {
  const endpoint = process.env.MYARTIFACT_S3_ENDPOINT;
  const bucket = process.env.MYARTIFACT_S3_BUCKET;
  const accessKeyId = process.env.MYARTIFACT_S3_ACCESS_KEY;
  const secretAccessKey = process.env.MYARTIFACT_S3_SECRET_KEY;
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return new S3CompatibleBlobStore({
      endpoint,
      region: process.env.MYARTIFACT_S3_REGION || 'us-east-1',
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.MYARTIFACT_S3_FORCE_PATH_STYLE !== 'false',
      publicEndpoint: process.env.MYARTIFACT_S3_PUBLIC_ENDPOINT,
    });
  }
  return new LocalDiskBlobStore(path.join(dataDir, 'blobs'));
}
