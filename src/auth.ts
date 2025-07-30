import { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

export interface JWTPayload {
  sub: string;
  email?: string;
  nickname?: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  firebase?: {
    identities?: any;
    sign_in_provider?: string;
  };
}

export interface AuthenticatedContext {
  user: {
    userId: string;
    email?: string;
    nickname?: string;
  };
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(buffer))
    .map(b => String.fromCharCode(b))
    .join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// JWKSキャッシュ
interface JWKSCache {
  keys: any[];
  expiresAt: number;
}

const jwksCache = new Map<string, JWKSCache>();

async function fetchJWKS(jwksUrl: string): Promise<any[]> {
  const cached = jwksCache.get(jwksUrl);

  // キャッシュが有効な場合は使用
  if (cached && Date.now() < cached.expiresAt) {
    console.log('[JWT] Using cached JWKS');
    return cached.keys;
  }

  // console.log('[JWT] Fetching JWKS from server...');
  const jwksResponse = await fetch(jwksUrl);
  if (!jwksResponse.ok) {
    throw new Error(`Failed to fetch JWKS: ${jwksResponse.status}`);
  }

  const jwks = await jwksResponse.json() as { keys: any[] };

  // キャッシュに保存（1時間有効）
  const cacheExpiresAt = Date.now() + 60 * 60 * 1000; // 1時間
  jwksCache.set(jwksUrl, {
    keys: jwks.keys,
    expiresAt: cacheExpiresAt
  });

  // console.log(`[JWT] JWKS fetched and cached successfully. Keys count: ${jwks.keys.length}`);
  return jwks.keys;
}

async function verifyFirebaseJWT(token: string, projectId: string): Promise<JWTPayload> {
  const jwksUrl = `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`;

  // console.log(`[JWT] Starting Firebase JWT verification with JWKS URL: ${jwksUrl}`);

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(new TextDecoder().decode(base64urlToBuffer(headerB64)));
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBuffer(payloadB64)));

    // console.log(`[JWT] Token decoded - Issuer: ${payload.iss}, Audience: ${payload.aud}, Expiry: ${new Date(payload.exp * 1000).toISOString()}`);

    // 期限チェック
    if (payload.exp * 1000 < Date.now()) {
      throw new Error('Token expired');
    }

    // 発行者チェック
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.iss !== expectedIssuer) {
      throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`);
    }

    // オーディエンスチェック
    if (payload.aud !== projectId) {
      throw new Error(`Invalid audience: expected ${projectId}, got ${payload.aud}`);
    }

    // JWKS取得（キャッシュ使用）
    const keys = await fetchJWKS(jwksUrl);

    // kid一致する鍵を探す
    const key = keys.find((k: any) => k.kid === header.kid);
    if (!key) {
      throw new Error(`Key not found for kid: ${header.kid}`);
    }

    // console.log(`[JWT] Matching key found for kid: ${header.kid}`);

    // 公開鍵をインポート
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: key.kty,
        n: key.n,
        e: key.e,
        alg: key.alg,
        use: key.use,
      },
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );

    // 署名検証
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64urlToBuffer(signatureB64);

    // console.log('[JWT] Verifying signature...');
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      data
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // console.log('[JWT] Firebase JWT verified successfully');
    return payload as JWTPayload;
  } catch (error) {
    console.error('[JWT] Firebase JWT verification failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new Error('Invalid Firebase token');
  }
}

export const firebaseAuth = (options?: {
  projectId?: string;
}): MiddlewareHandler => {
  return async (c, next) => {
    const requestPath = c.req.path;
    const requestMethod = c.req.method;

    // console.log(`[AUTH] ${requestMethod} ${requestPath} - Firebase authentication check started`);

    const projectId = options?.projectId || c.env?.FIREBASE_PROJECT_ID;

    // console.log(`[AUTH] Configuration: projectId=${projectId ? 'SET' : 'NOT_SET'}`);

    if (!projectId) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - Firebase Project ID not configured`);
      throw new HTTPException(500, { message: 'Firebase Project ID not configured' });
    }

    const authorization = c.req.header('Authorization');
    // console.log(`[AUTH] ${requestMethod} ${requestPath} - Authorization header: ${authorization ? 'PRESENT' : 'MISSING'}`);

    if (!authorization) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - No Authorization header`);
      throw new HTTPException(401, { message: 'Authorization header required' });
    }

    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - No Bearer token found. Authorization header: ${authorization}`);
      throw new HTTPException(401, { message: 'Bearer token required' });
    }

    // console.log(`[AUTH] ${requestMethod} ${requestPath} - Token extracted (length: ${token.length})`);

    try {
      // console.log(`[AUTH] ${requestMethod} ${requestPath} - Starting Firebase JWT verification`);
      const payload = await verifyFirebaseJWT(token, projectId);

      // console.log(`[AUTH] ${requestMethod} ${requestPath} - Firebase JWT verified successfully. User: ${payload.sub}, Audience: ${payload.aud}`);

      c.set('user', {
        userId: payload.sub,
        email: payload.email,
        nickname: payload.nickname,
      });

      // console.log(`[AUTH] ${requestMethod} ${requestPath} - Authentication successful for user: ${payload.sub}`);
      await next();
    } catch (error) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - Authentication failed:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        projectId
      });

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(401, { message: 'Invalid or expired token' });
    }
  };
};

export const getAuthenticatedUser = (c: any): AuthenticatedContext['user'] => {
  const user = c.get('user');
  if (!user) {
    throw new HTTPException(401, { message: 'User not authenticated' });
  }
  return user;
};
