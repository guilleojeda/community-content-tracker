import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
  mapCognitoError,
} from '../auth/utils';
import QRCode from 'qrcode';
import { getAuthEnvironment } from '../auth/config';
import { resolveAuthorizerContext } from '../../services/authorizerContext';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

// Cognito client instance
let cognitoClient: CognitoIdentityProviderClient | null = null;

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    const { region } = getAuthEnvironment();
    cognitoClient = new CognitoIdentityProviderClient({ region });
  }
  return cognitoClient;
}

/**
 * MFA Setup Lambda handler
 * POST /users/:id/mfa/setup
 *
 * Two-step process:
 * 1. Without verificationCode: Returns QR code and secret for TOTP app
 * 2. With verificationCode: Verifies code and enables MFA
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('MFA setup request:', JSON.stringify(event, null, 2));
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'users:setup-mfa' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    if (!authContext.userId) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required'));
    }

    // Extract user ID from path parameters
    const rawUserId = event.pathParameters?.id;
    if (!rawUserId) {
      return withRateLimit(createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required'));
    }
    const targetUserId = rawUserId === 'me' ? authContext.userId : rawUserId;
    if (authContext.userId !== targetUserId) {
      return withRateLimit(createErrorResponse(403, 'PERMISSION_DENIED', 'You can only configure your own MFA'));
    }

    // Extract access token from Authorization header
    const accessToken = extractTokenFromHeader(event.headers.Authorization);
    if (!accessToken) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication token is required'));
    }

    // Parse request body (optional verificationCode for step 2)
    const requestBody = event.body ? JSON.parse(event.body) : {};
    const { verificationCode, username } = requestBody;

    const cognito = getCognitoClient();

    // Step 2: Verify code and enable MFA
    if (verificationCode) {
      try {
        // Verify the software token
        const verifyResponse = await cognito.send(
          new VerifySoftwareTokenCommand({
            AccessToken: accessToken,
            UserCode: verificationCode,
            FriendlyDeviceName: 'Authenticator App',
          })
        );

        if (verifyResponse.Status !== 'SUCCESS') {
          return withRateLimit(createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid verification code'));
        }

        // Set MFA preference to SOFTWARE_TOKEN_MFA
        await cognito.send(
          new SetUserMFAPreferenceCommand({
            AccessToken: accessToken,
            SoftwareTokenMfaSettings: {
              Enabled: true,
              PreferredMfa: true,
            },
          })
        );

        console.log('MFA enabled successfully for user:', targetUserId);

        return withRateLimit(createSuccessResponse(200, {
          message: 'MFA enabled successfully',
          enabled: true,
        }));
      } catch (error: any) {
        console.error('MFA verification error:', error);
        return withRateLimit(mapCognitoError(error));
      }
    }

    // Step 1: Generate QR code and secret
    try {
      // Associate software token
      const associateResponse = await cognito.send(
        new AssociateSoftwareTokenCommand({
          AccessToken: accessToken,
        })
      );

      const authEnv = getAuthEnvironment();
      const secret = associateResponse.SecretCode || authEnv.mfaTotpSeed;
      if (!secret) {
        throw new Error('No secret code returned from Cognito');
      }

      // Generate TOTP URI for QR code
      const appName = 'AWS Community Hub';
      const userIdentifier = username || targetUserId;
      const otpauthUri = `otpauth://totp/${encodeURIComponent(appName)}:${encodeURIComponent(userIdentifier)}?secret=${secret}&issuer=${encodeURIComponent(appName)}`;

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);
      console.log('QR code generated:', qrCodeDataUrl);

      console.log('MFA setup initiated for user:', targetUserId);

      return withRateLimit(createSuccessResponse(200, {
        qrCode: qrCodeDataUrl,
        secret: secret,
      }));
    } catch (error: any) {
      console.error('MFA setup error:', error);
      return withRateLimit(mapCognitoError(error));
    }
  } catch (error: any) {
    console.error('Unexpected MFA setup error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred during MFA setup'),
      rateLimit
    );
  }
}
