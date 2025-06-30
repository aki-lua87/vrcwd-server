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
  
  try {
    const [header, payload] = token.split('.');
    if (!header || !payload) {
      throw new Error('Invalid token format');
    }

    const decodedHeader = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/')));
    const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));

    if (decodedPayload.exp * 1000 < Date.now()) {
      throw new Error('Token expired');
    }

    if (!decodedPayload.iss || !decodedPayload.iss.includes(userPoolId)) {
      throw new Error('Invalid issuer');
    }

    const jwksResponse = await fetch(jwksUrl);
    if (!jwksResponse.ok) {
      throw new Error('Failed to fetch JWKS');
    }

    const jwks = await jwksResponse.json() as { keys: any[] };
    const key = jwks.keys.find((k: any) => k.kid === decodedHeader.kid);
    
    if (!key) {
      throw new Error('Key not found in JWKS');
    }

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

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      data
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    return decodedPayload as JWTPayload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    throw new Error('Invalid token');
  }
}

export const cognitoAuth = (options?: {
  userPoolId?: string;
  region?: string;
  clientId?: string;
}): MiddlewareHandler => {
  return async (c, next) => {
    const userPoolId = options?.userPoolId || c.env?.COGNITO_USER_POOL_ID;
    const region = options?.region || c.env?.AWS_REGION || 'ap-northeast-1';
    const clientId = options?.clientId || c.env?.COGNITO_CLIENT_ID;

    if (!userPoolId) {
      throw new HTTPException(500, { message: 'Cognito User Pool ID not configured' });
    }

    const authorization = c.req.header('Authorization');
    if (!authorization) {
      throw new HTTPException(401, { message: 'Authorization header required' });
    }

    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new HTTPException(401, { message: 'Bearer token required' });
    }

    try {
      const payload = await verifyJWT(token, userPoolId, region);
      
      if (clientId && payload.aud !== clientId) {
        throw new HTTPException(401, { message: 'Invalid audience' });
      }

      if (payload.token_use !== 'id') {
        throw new HTTPException(401, { message: 'Invalid token use' });
      }

      c.set('user', {
        userId: payload.sub,
        email: payload.email,
        nickname: payload.nickname,
      });

      await next();
    } catch (error) {
      console.error('Authentication failed:', error);
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