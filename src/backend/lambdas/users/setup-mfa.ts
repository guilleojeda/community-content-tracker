import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { MfaSetupResponse } from '../../../shared/types';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
  mapCognitoError,
} from '../auth/utils';
import QRCode from 'qrcode';
import { getAuthEnvironment } from '../auth/config';

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

  try {
    // Extract user ID from path parameters
    const userId = event.pathParameters?.id;
    if (!userId) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required');
    }

    // Extract access token from Authorization header
    const accessToken = extractTokenFromHeader(event.headers.Authorization);
    if (!accessToken) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication token is required');
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
          return createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid verification code');
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

        console.log('MFA enabled successfully for user:', userId);

        return createSuccessResponse(200, {
          message: 'MFA enabled successfully',
          enabled: true,
        });
      } catch (error: any) {
        console.error('MFA verification error:', error);
        return mapCognitoError(error);
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
      const userIdentifier = username || userId;
      const otpauthUri = `otpauth://totp/${encodeURIComponent(appName)}:${encodeURIComponent(userIdentifier)}?secret=${secret}&issuer=${encodeURIComponent(appName)}`;

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);
      console.log('QR code generated:', qrCodeDataUrl);

      console.log('MFA setup initiated for user:', userId);

      return createSuccessResponse(200, {
        qrCode: qrCodeDataUrl,
        secret: secret,
      });
    } catch (error: any) {
      console.error('MFA setup error:', error);
      return mapCognitoError(error);
    }
  } catch (error: any) {
    console.error('Unexpected MFA setup error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred during MFA setup');
  }
}
