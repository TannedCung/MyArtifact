import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentScope, AuthSessionKind } from '../../core/types.js';

export interface AccessJwtClaims {
  iss: string;
  sub: string;
  sid: string;
  email: string;
  hd?: string;
  sessionKind: AuthSessionKind;
  scopes: AgentScope[];
  ws?: string;
  iat: number;
  exp: number;
}

export interface CookieSessionPayload {
  sid: string;
  sub: string;
  csrf: string;
  iat: number;
  exp: number;
}

export interface KeyManagerOptions {
  dataDir?: string;
  privateKeyPem?: string;
  publicKeyPem?: string;
  cookieSecret?: string;
  secret?: string;
  issuer?: string;
}

const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/**
 * Deterministically derive an ES256 (P-256) keypair from a single master secret
 * so stateless serverless instances verify each other's JWTs across cold starts.
 */
export function deriveEs256KeyPairFromSecret(secret: string): {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
} {
  let dBuf: Buffer | null = null;
  for (let counter = 0; counter < 16; counter++) {
    const candidate = Buffer.from(
      crypto.hkdfSync('sha256', secret, 'myartifact-cloud-salt', `jwt-es256-v1:${counter}`, 32)
    );
    const scalar = BigInt(`0x${candidate.toString('hex')}`);
    if (scalar > 0n && scalar < P256_ORDER) {
      dBuf = candidate;
      break;
    }
  }
  if (!dBuf) {
    throw new Error('Failed to derive valid P-256 scalar from secret');
  }

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(dBuf);
  const pub = ecdh.getPublicKey(); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = pub.subarray(1, 33).toString('base64url');
  const y = pub.subarray(33, 65).toString('base64url');
  const d = dBuf.toString('base64url');

  const privateKey = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d },
    format: 'jwk',
  });
  const publicKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x, y },
    format: 'jwk',
  });
  return { privateKey, publicKey };
}

function deriveCookieSecretFromMaster(secret: string): string {
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, 'myartifact-cloud-salt', 'cookie-hmac-v1', 32)
  ).toString('hex');
}

function base64UrlEncode(buf: Buffer | string): string {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')).toString('base64url');
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateOpaqueToken(prefix = 'ma_tok_', bytes = 32): string {
  return `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  if (!codeVerifier || !expectedChallenge) return false;
  const computed = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(expectedChallenge, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export class CloudTokenService {
  private readonly privateKey: crypto.KeyObject;
  private readonly publicKey: crypto.KeyObject;
  private readonly cookieSecret: string;
  public readonly issuer: string;

  constructor(options: KeyManagerOptions = {}) {
    this.issuer = options.issuer || process.env.MYARTIFACT_JWT_ISSUER || 'myartifact-cloud';

    const envPriv = options.privateKeyPem || process.env.MYARTIFACT_JWT_PRIVATE_KEY_PEM;
    const envPub = options.publicKeyPem || process.env.MYARTIFACT_JWT_PUBLIC_KEY_PEM;
    const masterSecret =
      options.secret ||
      process.env.MYARTIFACT_SECRET ||
      (!options.dataDir ? options.cookieSecret || process.env.MYARTIFACT_COOKIE_SECRET : undefined);

    if (envPriv && envPub) {
      this.privateKey = crypto.createPrivateKey(envPriv.replace(/\\n/g, '\n'));
      this.publicKey = crypto.createPublicKey(envPub.replace(/\\n/g, '\n'));
      this.cookieSecret =
        options.cookieSecret ||
        process.env.MYARTIFACT_COOKIE_SECRET ||
        (masterSecret
          ? deriveCookieSecretFromMaster(masterSecret)
          : crypto.randomBytes(32).toString('hex'));
      return;
    }

    if (masterSecret) {
      const derived = deriveEs256KeyPairFromSecret(masterSecret);
      this.privateKey = derived.privateKey;
      this.publicKey = derived.publicKey;
      this.cookieSecret =
        options.cookieSecret ||
        process.env.MYARTIFACT_COOKIE_SECRET ||
        deriveCookieSecretFromMaster(masterSecret);
      return;
    }

    if (options.dataDir) {
      const keyFile = path.join(path.resolve(options.dataDir), 'keys', 'jwt-es256.json');
      if (fs.existsSync(keyFile)) {
        const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8')) as {
          privateKeyPem: string;
          publicKeyPem: string;
          cookieSecret?: string;
        };
        this.privateKey = crypto.createPrivateKey(parsed.privateKeyPem);
        this.publicKey = crypto.createPublicKey(parsed.publicKeyPem);
        this.cookieSecret =
          options.cookieSecret ||
          process.env.MYARTIFACT_COOKIE_SECRET ||
          parsed.cookieSecret ||
          crypto.randomBytes(32).toString('hex');
        return;
      }
      const pair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const cookieSecret =
        options.cookieSecret ||
        process.env.MYARTIFACT_COOKIE_SECRET ||
        crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        keyFile,
        JSON.stringify({ privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey, cookieSecret }),
        { encoding: 'utf8', mode: 0o600 }
      );
      this.privateKey = crypto.createPrivateKey(pair.privateKey);
      this.publicKey = crypto.createPublicKey(pair.publicKey);
      this.cookieSecret = cookieSecret;
      return;
    }

    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.cookieSecret =
      options.cookieSecret ||
      process.env.MYARTIFACT_COOKIE_SECRET ||
      crypto.randomBytes(32).toString('hex');
  }

  public signAccessJwt(
    claims: Omit<AccessJwtClaims, 'iss' | 'iat' | 'exp'>,
    ttlSeconds = 900
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const fullClaims: AccessJwtClaims = {
      iss: this.issuer,
      ...claims,
      iat: now,
      exp: now + ttlSeconds,
    };
    const header = base64UrlEncode(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
    const payload = base64UrlEncode(JSON.stringify(fullClaims));
    const signingInput = `${header}.${payload}`;
    const sig = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
      key: this.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `${signingInput}.${base64UrlEncode(sig)}`;
  }

  public verifyAccessJwt(token: string): AccessJwtClaims | null {
    try {
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
      const [hB64, pB64, sigB64] = parts;
      const header = JSON.parse(base64UrlDecode(hB64).toString('utf8')) as { alg?: string };
      if (!header || typeof header !== 'object' || header.alg !== 'ES256') return null;

      const ok = crypto.verify(
        'sha256',
        Buffer.from(`${hB64}.${pB64}`, 'utf8'),
        { key: this.publicKey, dsaEncoding: 'ieee-p1363' },
        base64UrlDecode(sigB64)
      );
      if (!ok) return null;

      const claims = JSON.parse(base64UrlDecode(pB64).toString('utf8')) as AccessJwtClaims;
      if (!claims || typeof claims !== 'object') return null;
      const now = Math.floor(Date.now() / 1000);
      if (claims.iss !== this.issuer) return null;
      if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now) {
        return null;
      }
      if (
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        typeof claims.sid !== 'string' ||
        !claims.sid
      ) {
        return null;
      }
      return claims;
    } catch {
      return null;
    }
  }

  public signSessionCookie(sid: string, sub: string, ttlSeconds = 7 * 24 * 3600): {
    cookieValue: string;
    csrfToken: string;
  } {
    const now = Math.floor(Date.now() / 1000);
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const payload: CookieSessionPayload = {
      sid,
      sub,
      csrf: csrfToken,
      iat: now,
      exp: now + ttlSeconds,
    };
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const sig = crypto
      .createHmac('sha256', this.cookieSecret)
      .update(payloadB64, 'utf8')
      .digest('base64url');
    return {
      cookieValue: `${payloadB64}.${sig}`,
      csrfToken,
    };
  }

  public verifySessionCookie(cookieValue: string): CookieSessionPayload | null {
    try {
      if (!cookieValue || typeof cookieValue !== 'string') return null;
      const dot = cookieValue.indexOf('.');
      if (dot <= 0) return null;
      const payloadB64 = cookieValue.slice(0, dot);
      const sigB64 = cookieValue.slice(dot + 1);
      const expected = crypto
        .createHmac('sha256', this.cookieSecret)
        .update(payloadB64, 'utf8')
        .digest('base64url');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(sigB64, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      const parsed = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as CookieSessionPayload;
      if (!parsed || typeof parsed !== 'object') return null;
      const now = Math.floor(Date.now() / 1000);
      if (
        typeof parsed.exp !== 'number' ||
        !Number.isFinite(parsed.exp) ||
        parsed.exp <= now ||
        typeof parsed.sid !== 'string' ||
        !parsed.sid ||
        typeof parsed.sub !== 'string' ||
        !parsed.sub ||
        typeof parsed.csrf !== 'string' ||
        !parsed.csrf
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
