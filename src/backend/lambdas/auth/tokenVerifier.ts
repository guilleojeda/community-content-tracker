import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { UserRepository } from '../../repositories/UserRepository';
import { User } from '../../../shared/types';

/**
 * Cognito JWT token claims interface
 */
export interface CognitoTokenClaims {
  sub: string;
  'cognito:username': string;
  email: string;
  email_verified: boolean;
  aud: string;
  iss: string;
  token_use: 'access' | 'id';
  exp: number;
  iat: number;
  'custom:is_admin'?: string;
  'custom:username'?: string;
  [key: string]: any;
}

/**
 * Token verification error types
 */
export interface TokenVerificationError {
  code: 'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'MISSING_TOKEN' | 'USER_NOT_FOUND' |
        'DATABASE_ERROR' | 'NETWORK_ERROR' | 'INVALID_CONFIG' | 'VERIFICATION_ERROR' |
        'INVALID_TOKEN_USE' | 'EMAIL_NOT_VERIFIED' | 'INVALID_CLAIMS';
  message: string;
  details: string;
}

/**
 * Token verification result
 */
export interface TokenVerificationResult {
  isValid: boolean;
  user?: User;
  claims?: CognitoTokenClaims;
  error?: TokenVerificationError;
}

/**
 * Token verifier configuration
 */
export interface TokenVerifierConfig {
  cognitoUserPoolId: string;
  cognitoRegion: string;
  allowedAudiences: string[];
  issuer: string;
}

/**
 * JWKS client for retrieving public keys
 */
let jwksClientInstance: jwksClient.JwksClient | null = null;

/**
 * Get JWKS client instance (singleton)
 */
function getJwksClient(config: TokenVerifierConfig): jwksClient.JwksClient {
  if (!jwksClientInstance) {
    const jwksUri = `https://cognito-idp.${config.cognitoRegion}.amazonaws.com/${config.cognitoUserPoolId}/.well-known/jwks.json`;

    jwksClientInstance = jwksClient({
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      jwksUri,
    });
  }

  return jwksClientInstance;
}

/**
 * Get signing key from JWKS
 */
function getSigningKey(kid: string, config: TokenVerifierConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = getJwksClient(config);

    client.getSigningKey(kid, (err, key) => {
      if (err) {
        reject(err);
        return;
      }

      const signingKey = key?.getPublicKey();
      if (!signingKey) {
        reject(new Error('No signing key found'));
        return;
      }

      resolve(signingKey);
    });
  });
}

/**
 * Validate token configuration
 */
function validateConfig(config: TokenVerifierConfig): void {
  if (!config.cognitoUserPoolId || !config.cognitoUserPoolId.trim()) {
    throw new Error('Invalid configuration: cognitoUserPoolId is required');
  }

  if (!config.cognitoRegion || !config.cognitoRegion.trim()) {
    throw new Error('Invalid configuration: cognitoRegion is required');
  }

  if (!config.allowedAudiences || config.allowedAudiences.length === 0) {
    throw new Error('Invalid configuration: allowedAudiences is required');
  }

  if (!config.issuer || !config.issuer.trim()) {
    throw new Error('Invalid configuration: issuer is required');
  }
}

/**
 * Validate token claims
 */
function validateClaims(claims: any): TokenVerificationError | null {
  if (!claims) {
    return {
      code: 'INVALID_CLAIMS',
      message: 'Token claims are missing',
      details: 'No claims found in token',
    };
  }

  if (!claims.sub) {
    return {
      code: 'INVALID_CLAIMS',
      message: 'Token is missing required subject claim',
      details: 'Sub claim is required',
    };
  }

  if (!claims.email) {
    return {
      code: 'INVALID_CLAIMS',
      message: 'Token is missing required email claim',
      details: 'Email claim is required',
    };
  }

  if (!claims.aud) {
    return {
      code: 'INVALID_CLAIMS',
      message: 'Token is missing required audience claim',
      details: 'Audience claim is required',
    };
  }

  if (!claims.iss) {
    return {
      code: 'INVALID_CLAIMS',
      message: 'Token is missing required issuer claim',
      details: 'Issuer claim is required',
    };
  }

  if (claims.token_use !== 'access') {
    return {
      code: 'INVALID_TOKEN_USE',
      message: 'Invalid token type',
      details: `Expected access token, got ${claims.token_use}`,
    };
  }

  if (claims.email_verified === false) {
    return {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email address not verified',
      details: 'User email must be verified to access the API',
    };
  }

  return null;
}

/**
 * Decode JWT header to get key ID
 */
function getKeyIdFromToken(token: string): string | null {
  try {
    const decoded = jwt.decode(token, { complete: true });
    return decoded?.header?.kid || null;
  } catch (error) {
    return null;
  }
}

/**
 * Verify JWT token against Cognito
 */
export async function verifyJwtToken(
  token: string,
  config: TokenVerifierConfig,
  userRepository: UserRepository
): Promise<TokenVerificationResult> {
  try {
    // Validate input
    if (!token || token.trim() === '') {
      return {
        isValid: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Token is required',
          details: 'No token provided',
        },
      };
    }

    // Validate configuration
    try {
      validateConfig(config);
    } catch (configError: any) {
      return {
        isValid: false,
        error: {
          code: 'INVALID_CONFIG',
          message: 'Invalid token verifier configuration',
          details: configError.message,
        },
      };
    }

    // Get key ID from token
    const kid = getKeyIdFromToken(token);
    if (!kid) {
      return {
        isValid: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token is invalid or malformed',
          details: 'Cannot extract key ID from token header',
        },
      };
    }

    // Get signing key
    let signingKey: string;
    try {
      signingKey = await getSigningKey(kid, config);
    } catch (keyError: any) {
      if (keyError.code === 'ETIMEDOUT' || keyError.code === 'ENOTFOUND') {
        return {
          isValid: false,
          error: {
            code: 'NETWORK_ERROR',
            message: 'Network error while retrieving signing key',
            details: keyError.message,
          },
        };
      }

      return {
        isValid: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Cannot retrieve signing key',
          details: keyError.message,
        },
      };
    }

    // Verify token
    let claims: CognitoTokenClaims;
    try {
      claims = await new Promise<CognitoTokenClaims>((resolve, reject) => {
        jwt.verify(
          token,
          signingKey,
          {
            algorithms: ['RS256'],
            audience: config.allowedAudiences,
            issuer: config.issuer,
          },
          (err, decoded) => {
            if (err) {
              reject(err);
            } else {
              resolve(decoded as CognitoTokenClaims);
            }
          }
        );
      });
    } catch (verifyError: any) {
      if (verifyError.name === 'TokenExpiredError') {
        return {
          isValid: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token has expired',
            details: verifyError.message,
          },
        };
      }

      if (verifyError.name === 'JsonWebTokenError') {
        return {
          isValid: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Token is invalid or malformed',
            details: verifyError.message,
          },
        };
      }

      if (verifyError.code === 'ETIMEDOUT') {
        return {
          isValid: false,
          error: {
            code: 'NETWORK_ERROR',
            message: 'Network timeout during token verification',
            details: verifyError.message,
          },
        };
      }

      return {
        isValid: false,
        error: {
          code: 'VERIFICATION_ERROR',
          message: 'Unexpected error during token verification',
          details: verifyError.message,
        },
      };
    }

    // Validate claims
    const claimsError = validateClaims(claims);
    if (claimsError) {
      return {
        isValid: false,
        error: claimsError,
      };
    }

    // Get user from database
    let user: User | null;
    try {
      user = await userRepository.findByCognitoSub(claims.sub);
    } catch (dbError: any) {
      return {
        isValid: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to retrieve user data',
          details: dbError.message,
        },
      };
    }

    // Check if user exists in database
    if (!user) {
      return {
        isValid: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found in database',
          details: 'Cognito user exists but not found in application database',
        },
      };
    }

    return {
      isValid: true,
      user,
      claims,
    };

  } catch (error: any) {
    return {
      isValid: false,
      error: {
        code: 'VERIFICATION_ERROR',
        message: 'Unexpected error during token verification',
        details: error.message,
      },
    };
  }
}

/**
 * Verify token with cached result for performance
 */
const tokenCache = new Map<string, { result: TokenVerificationResult; expiry: number }>();
const CACHE_TTL = 300000; // 5 minutes

export async function verifyJwtTokenWithCache(
  token: string,
  config: TokenVerifierConfig,
  userRepository: UserRepository
): Promise<TokenVerificationResult> {
  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && cached.expiry > Date.now()) {
    return cached.result;
  }

  // Verify token
  const result = await verifyJwtToken(token, config, userRepository);

  // Cache valid results only
  if (result.isValid) {
    tokenCache.set(token, {
      result,
      expiry: Date.now() + CACHE_TTL,
    });

    // Clean up expired cache entries periodically
    if (tokenCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of tokenCache.entries()) {
        if (value.expiry <= now) {
          tokenCache.delete(key);
        }
      }
    }
  }

  return result;
}

/**
 * Clear token cache (useful for testing)
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Token refresh handler for Lambda
 */
export interface TokenRefreshEvent {
  refreshToken: string;
  clientId: string;
}

export interface TokenRefreshResult {
  success: boolean;
  accessToken?: string;
  idToken?: string;
  expiresIn?: number;
  error?: {
    code: string;
    message: string;
    details: string;
  };
}

/**
 * Handle token refresh using Cognito
 */
export async function handleTokenRefresh(
  event: TokenRefreshEvent
): Promise<TokenRefreshResult> {
  try {
    const { CognitoIdentityServiceProvider } = await import('aws-sdk');
    const cognito = new CognitoIdentityServiceProvider();

    const params = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: event.clientId,
      AuthParameters: {
        REFRESH_TOKEN: event.refreshToken,
      },
    };

    const result = await cognito.initiateAuth(params).promise();

    if (!result.AuthenticationResult) {
      return {
        success: false,
        error: {
          code: 'REFRESH_FAILED',
          message: 'Failed to refresh token',
          details: 'No authentication result returned',
        },
      };
    }

    return {
      success: true,
      accessToken: result.AuthenticationResult.AccessToken,
      idToken: result.AuthenticationResult.IdToken,
      expiresIn: result.AuthenticationResult.ExpiresIn,
    };

  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'REFRESH_ERROR',
        message: 'Error refreshing token',
        details: error.message,
      },
    };
  }
}