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
  token_use: string;
}

export interface AuthenticatedContext {
  user: {
    userId: string;
    email?: string;
    nickname?: string;
  };
}

async function verifyJWT(token: string, userPoolId: string, region: string): Promise<JWTPayload> {
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  
  console.log(`[JWT] Starting verification with JWKS URL: ${jwksUrl}`);
  
  try {
    const [header, payload] = token.split('.');
    if (!header || !payload) {
      console.error('[JWT] Invalid token format: missing header or payload');
      throw new Error('Invalid token format');
    }

    console.log('[JWT] Token parts extracted successfully');

    const decodedHeader = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/')));
    const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));

    console.log(`[JWT] Token decoded - Issuer: ${decodedPayload.iss}, Audience: ${decodedPayload.aud}, Expiry: ${new Date(decodedPayload.exp * 1000).toISOString()}, Token use: ${decodedPayload.token_use}`);

    if (decodedPayload.exp * 1000 < Date.now()) {
      console.error(`[JWT] Token expired: exp=${new Date(decodedPayload.exp * 1000).toISOString()}, now=${new Date().toISOString()}`);
      throw new Error('Token expired');
    }

    if (!decodedPayload.iss || !decodedPayload.iss.includes(userPoolId)) {
      console.error(`[JWT] Invalid issuer: expected issuer containing '${userPoolId}', got '${decodedPayload.iss}'`);
      throw new Error('Invalid issuer');
    }

    console.log('[JWT] Fetching JWKS...');
    const jwksResponse = await fetch(jwksUrl);
    if (!jwksResponse.ok) {
      console.error(`[JWT] Failed to fetch JWKS: ${jwksResponse.status} ${jwksResponse.statusText}`);
      throw new Error('Failed to fetch JWKS');
    }

    const jwks = await jwksResponse.json() as { keys: any[] };
    console.log(`[JWT] JWKS fetched successfully. Keys count: ${jwks.keys.length}`);
    
    const key = jwks.keys.find((k: any) => k.kid === decodedHeader.kid);
    
    if (!key) {
      console.error(`[JWT] Key not found in JWKS: looking for kid='${decodedHeader.kid}', available kids: ${jwks.keys.map((k: any) => k.kid).join(', ')}`);
      throw new Error('Key not found in JWKS');
    }
    
    console.log(`[JWT] Matching key found for kid: ${decodedHeader.kid}`);

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

    const encoder = new TextEncoder();
    const data = encoder.encode(`${header}.${payload}`);
    const signatureBytes = Uint8Array.from(atob(token.split('.')[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    console.log('[JWT] Verifying signature...');
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      data
    );

    if (!isValid) {
      console.error('[JWT] Invalid signature verification failed');
      throw new Error('Invalid signature');
    }

    console.log('[JWT] Signature verification successful');
    return decodedPayload as JWTPayload;
  } catch (error) {
    console.error('[JWT] JWT verification failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new Error('Invalid token');
  }
}

export const cognitoAuth = (options?: {
  userPoolId?: string;
  region?: string;
  clientId?: string;
}): MiddlewareHandler => {
  return async (c, next) => {
    const requestPath = c.req.path;
    const requestMethod = c.req.method;
    
    console.log(`[AUTH] ${requestMethod} ${requestPath} - Authentication check started`);
    
    const userPoolId = options?.userPoolId || c.env?.COGNITO_USER_POOL_ID;
    const region = options?.region || c.env?.AWS_REGION || 'ap-northeast-1';
    const clientId = options?.clientId || c.env?.COGNITO_CLIENT_ID;

    console.log(`[AUTH] Configuration: userPoolId=${userPoolId ? 'SET' : 'NOT_SET'}, region=${region}, clientId=${clientId ? 'SET' : 'NOT_SET'}`);

    if (!userPoolId) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - Cognito User Pool ID not configured`);
      throw new HTTPException(500, { message: 'Cognito User Pool ID not configured' });
    }

    const authorization = c.req.header('Authorization');
    console.log(`[AUTH] ${requestMethod} ${requestPath} - Authorization header: ${authorization ? 'PRESENT' : 'MISSING'}`);
    
    if (!authorization) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - No Authorization header`);
      throw new HTTPException(401, { message: 'Authorization header required' });
    }

    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - No Bearer token found. Authorization header: ${authorization}`);
      throw new HTTPException(401, { message: 'Bearer token required' });
    }
    
    console.log(`[AUTH] ${requestMethod} ${requestPath} - Token extracted (length: ${token.length})`);

    try {
      console.log(`[AUTH] ${requestMethod} ${requestPath} - Starting JWT verification`);
      const payload = await verifyJWT(token, userPoolId, region);
      
      console.log(`[AUTH] ${requestMethod} ${requestPath} - JWT verified successfully. User: ${payload.sub}, Audience: ${payload.aud}, Token use: ${payload.token_use}`);
      
      if (clientId && payload.aud !== clientId) {
        console.error(`[AUTH] ${requestMethod} ${requestPath} - Invalid audience: expected ${clientId}, got ${payload.aud}`);
        throw new HTTPException(401, { message: 'Invalid audience' });
      }

      if (payload.token_use !== 'id') {
        console.error(`[AUTH] ${requestMethod} ${requestPath} - Invalid token use: expected 'id', got '${payload.token_use}'`);
        throw new HTTPException(401, { message: 'Invalid token use' });
      }

      c.set('user', {
        userId: payload.sub,
        email: payload.email,
        nickname: payload.nickname,
      });

      console.log(`[AUTH] ${requestMethod} ${requestPath} - Authentication successful for user: ${payload.sub}`);
      await next();
    } catch (error) {
      console.error(`[AUTH] ${requestMethod} ${requestPath} - Authentication failed:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        userPoolId,
        region,
        clientId
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