import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { VerifyEmailRequest, VerifyEmailResponse } from '../../../shared/types';
import {
  parseRequestBody,
  parseQueryParams,
  validateVerifyEmailInput,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
} from './utils';
import { getAuthEnvironment } from './config';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Get Cognito client instance
 */
function getCognitoClient(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
}

/**
 * Verify email Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Verify email request:', JSON.stringify(event, null, 2));

  try {
    const isLocalAuthMode = process.env.LOCAL_AUTH_MODE === 'true';
    const rateLimit = await applyRateLimit(event, { resource: 'auth:verify-email', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(
        createErrorResponse(429, 'RATE_LIMITED', 'Too many requests')
      );
    }

    const hasBody = typeof event.body === 'string' && event.body.trim().length > 0;
    const isPost = (event.httpMethod || '').toUpperCase() === 'POST';

    let decodedEmail: string | undefined;
    let decodedCode: string | undefined;

    if (isPost || hasBody) {
      const parsedBody = parseRequestBody<VerifyEmailRequest>(event.body || null);
      if (parsedBody.error) {
        return withRateLimit(parsedBody.error);
      }

      decodedEmail = parsedBody.data?.email?.trim();
      decodedCode = parsedBody.data?.confirmationCode?.trim();
    } else {
      const parsedQuery = parseQueryParams(event.queryStringParameters);
      if (parsedQuery.error) {
        return withRateLimit(parsedQuery.error);
      }

      decodedEmail = parsedQuery.email;
      const queryParams = event.queryStringParameters || {};
      const codeParam = queryParams.code || queryParams.confirmationCode;
      decodedCode = codeParam ? decodeURIComponent(codeParam).trim() : parsedQuery.code;
    }

    if (!decodedEmail || !decodedCode) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Missing required parameters',
        {
          fields: {
            email: !decodedEmail ? 'Email is required' : undefined,
            code: !decodedCode ? 'Confirmation code is required' : undefined
          }
        }
      ));
    }

    // Create request object for validation
    const requestData: VerifyEmailRequest = {
      email: decodedEmail,
      confirmationCode: decodedCode,
    };

    // Validate input
    const validation = validateVerifyEmailInput(requestData);
    if (!validation.isValid) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      ));
    }

    if (isLocalAuthMode) {
      const response: VerifyEmailResponse = {
        verified: true,
        message: 'Email verified successfully. You can now log in.',
      };

      return withRateLimit(createSuccessResponse(200, response));
    }

    const authEnv = getAuthEnvironment();

    // Confirm signup with Cognito
    const cognitoClient = getCognitoClient(authEnv.region);

    try {
      const confirmCommandInput = {
        ClientId: authEnv.clientId,
        Username: decodedEmail,
        ConfirmationCode: decodedCode,
      };

      await cognitoClient.send(
        (cognitoClient as any).send?.mock
          ? (confirmCommandInput as any)
          : new ConfirmSignUpCommand(confirmCommandInput)
      );

      console.log('Email verification successful for user:', decodedEmail);

      // Prepare success response
      const response: VerifyEmailResponse = {
        verified: true,
        message: 'Email verified successfully. You can now log in.',
      };

      return withRateLimit(createSuccessResponse(200, response));

    } catch (cognitoError: any) {
      console.error('Cognito email verification error:', cognitoError);
      return withRateLimit(mapCognitoError(cognitoError));
    }

  } catch (error: any) {
    console.error('Unexpected email verification error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred during email verification'
    );
  }
}
