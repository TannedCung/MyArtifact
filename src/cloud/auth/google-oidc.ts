import crypto from 'node:crypto';
import type { UpsertGoogleUserInput } from '../store-interface.js';

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  acceptedIssuers?: string[];
}

interface JwkKey {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

export class GoogleOidcVerifier {
  public readonly clientId: string;
  private readonly clientSecret: string;
  public readonly authorizationEndpoint: string;
  public readonly tokenEndpoint: string;
  public readonly jwksUri: string;
  private readonly acceptedIssuers: string[];
  private cachedJwks: { keys: JwkKey[]; fetchedAt: number } | null = null;

  constructor(config: GoogleOidcConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.authorizationEndpoint =
      config.authorizationEndpoint || 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenEndpoint = config.tokenEndpoint || 'https://oauth2.googleapis.com/token';
    this.jwksUri = config.jwksUri || 'https://www.googleapis.com/oauth2/v3/certs';
    this.acceptedIssuers = config.acceptedIssuers || [
      'https://accounts.google.com',
      'accounts.google.com',
    ];
  }

  public static fromEnv(): GoogleOidcVerifier | null {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const customIssuer = process.env.GOOGLE_OIDC_ISSUER;
    return new GoogleOidcVerifier({
      clientId,
      clientSecret,
      authorizationEndpoint: process.env.GOOGLE_OIDC_AUTH_ENDPOINT,
      tokenEndpoint: process.env.GOOGLE_OIDC_TOKEN_ENDPOINT,
      jwksUri: process.env.GOOGLE_OIDC_JWKS_URI,
      acceptedIssuers: customIssuer ? [customIssuer] : undefined,
    });
  }

  public buildAuthorizationUrl(params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    hd?: string;
  }): string {
    const u = new URL(this.authorizationEndpoint);
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', params.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', params.state);
    u.searchParams.set('nonce', params.nonce);
    u.searchParams.set('code_challenge', params.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('access_type', 'online');
    u.searchParams.set('prompt', 'select_account');
    if (params.hd) {
      u.searchParams.set('hd', params.hd);
    }
    return u.toString();
  }

  public async exchangeCodeAndVerify(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    expectedNonce: string;
  }): Promise<UpsertGoogleUserInput> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    });

    const tokenRes = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      throw new Error(`Google OIDC token exchange failed (${tokenRes.status}): ${errText}`);
    }
    const tokenJson = (await tokenRes.json()) as { id_token?: string };
    if (!tokenJson.id_token) {
      throw new Error('Google OIDC response missing id_token');
    }

    return this.verifyIdToken(tokenJson.id_token, params.expectedNonce);
  }

  private async getJwks(forceRefresh = false): Promise<JwkKey[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedJwks && now - this.cachedJwks.fetchedAt < 300_000) {
      return this.cachedJwks.keys;
    }
    const res = await fetch(this.jwksUri, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch OIDC JWKS (${res.status})`);
    }
    const json = (await res.json()) as { keys?: JwkKey[] };
    const keys = Array.isArray(json.keys) ? json.keys : [];
    this.cachedJwks = { keys, fetchedAt: now };
    return keys;
  }

  public async verifyIdToken(idToken: string, expectedNonce: string): Promise<UpsertGoogleUserInput> {
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('Malformed OIDC id_token');
    }
    const parts = idToken.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error('Malformed OIDC id_token');
    }
    const [hB64, pB64, sigB64] = parts;
    let header: { alg?: string; kid?: string };
    let payload: {
      iss?: string;
      aud?: string | string[];
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      hd?: string;
      name?: string;
      picture?: string;
      nonce?: string;
      exp?: number;
    };
    try {
      header = JSON.parse(Buffer.from(hB64, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
      };
      payload = JSON.parse(Buffer.from(pB64, 'base64url').toString('utf8')) as typeof payload;
    } catch {
      throw new Error('Malformed OIDC id_token encoding or JSON');
    }
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
      throw new Error('Malformed OIDC id_token structure');
    }

    let keys = await this.getJwks(false);
    let jwk = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];
    if (!jwk) {
      keys = await this.getJwks(true);
      jwk = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];
    }
    if (!jwk) {
      throw new Error('Matching JWKS public key not found for id_token');
    }

    const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
    const signingInput = Buffer.from(`${hB64}.${pB64}`, 'utf8');
    const sig = Buffer.from(sigB64, 'base64url');

    let verifiedSig = false;
    if (header.alg === 'RS256') {
      verifiedSig = crypto.verify('RSA-SHA256', signingInput, publicKey, sig);
    } else if (header.alg === 'ES256') {
      verifiedSig = crypto.verify(
        'sha256',
        signingInput,
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        sig
      );
    } else {
      throw new Error(`Unsupported OIDC id_token alg: ${header.alg}`);
    }

    if (!verifiedSig) {
      throw new Error('Invalid OIDC id_token signature');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.iss || !this.acceptedIssuers.includes(payload.iss)) {
      throw new Error(`Invalid OIDC issuer: ${payload.iss}`);
    }
    const audMatch = Array.isArray(payload.aud)
      ? payload.aud.includes(this.clientId)
      : payload.aud === this.clientId;
    if (!audMatch) {
      throw new Error('OIDC audience mismatch');
    }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec - 60) {
      throw new Error('OIDC id_token expired');
    }
    if (!expectedNonce || typeof payload.nonce !== 'string' || !payload.nonce) {
      throw new Error('OIDC nonce mismatch');
    }
    const expectedNonceBuf = Buffer.from(expectedNonce, 'utf8');
    const actualNonceBuf = Buffer.from(payload.nonce, 'utf8');
    if (
      expectedNonceBuf.length !== actualNonceBuf.length ||
      !crypto.timingSafeEqual(expectedNonceBuf, actualNonceBuf)
    ) {
      throw new Error('OIDC nonce mismatch');
    }
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!emailVerified) {
      throw new Error('Google email_verified must be true');
    }
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email) {
      throw new Error('OIDC id_token missing sub or email');
    }

    return {
      googleSub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      emailVerified: true,
      ...(payload.hd ? { googleHd: payload.hd.trim().toLowerCase() } : {}),
      displayName: payload.name || payload.email.split('@')[0],
      ...(payload.picture ? { avatarUrl: payload.picture } : {}),
    };
  }
}
