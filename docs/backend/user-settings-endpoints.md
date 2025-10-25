# User Settings API Endpoints - Implementation Summary

## Overview
All 6 missing backend API endpoints for user settings have been successfully implemented with comprehensive testing and proper error handling.

## Implemented Endpoints

### 1. Change Password
**Endpoint:** `POST /users/:id/password`
**File:** `/src/backend/lambdas/users/change-password.ts`
**Test File:** `/tests/backend/lambdas/users/change-password.test.ts`

**Features:**
- Validates password complexity (min 12 chars, uppercase, lowercase, number, special char)
- Ensures new password is different from current password
- Integrates with AWS Cognito ChangePasswordCommand
- Proper error handling for Cognito errors (NotAuthorizedException, InvalidPasswordException)
- Returns standardized error responses per API error standards

**Request Body:**
```typescript
{
  currentPassword: string;
  newPassword: string;
}
```

**Response:**
```typescript
{
  message: "Password changed successfully"
}
```

**Error Codes:**
- `400 VALIDATION_ERROR` - Invalid input or weak password
- `401 AUTH_REQUIRED` - Missing authentication token
- `401 AUTH_INVALID` - Invalid current password or token
- `500 INTERNAL_ERROR` - Unexpected error

---

### 2. Update Email Preferences
**Endpoint:** `PATCH /users/:id/preferences`
**File:** `/src/backend/lambdas/users/update-preferences.ts`
**Test File:** `/tests/backend/lambdas/users/update-preferences.test.ts`

**Features:**
- Updates user email notification preferences
- Validates user can only update their own preferences
- Updates database directly with proper COALESCE for partial updates
- All preferences are optional booleans

**Request Body:**
```typescript
{
  receiveNewsletter?: boolean;
  receiveContentNotifications?: boolean;
  receiveCommunityUpdates?: boolean;
}
```

**Response:**
```typescript
{
  message: "Preferences updated successfully"
}
```

**Error Codes:**
- `400 VALIDATION_ERROR` - Invalid input or no preferences provided
- `401 AUTH_REQUIRED` - Missing authentication token
- `401 AUTH_INVALID` - Invalid token
- `403 PERMISSION_DENIED` - Attempting to update another user's preferences
- `500 INTERNAL_ERROR` - Database error

---

### 3. MFA Setup
**Endpoint:** `POST /users/:id/mfa/setup`
**File:** `/src/backend/lambdas/users/setup-mfa.ts`
**Test File:** `/tests/backend/lambdas/users/setup-mfa.test.ts`

**Features:**
- Two-step MFA setup process
- Step 1: Generates QR code and secret using AWS Cognito
- Step 2: Verifies TOTP code and enables MFA
- Uses `qrcode` package to generate QR code data URL
- Creates OTPAUTH URI compatible with authenticator apps (Google Authenticator, Authy, etc.)

**Step 1 Request (Generate QR):**
```typescript
{
  username?: string; // Optional, used in QR code label
}
```

**Step 1 Response:**
```typescript
{
  qrCode: string; // Data URL for QR code image
  secret: string; // Manual entry secret key
}
```

**Step 2 Request (Verify and Enable):**
```typescript
{
  verificationCode: string; // 6-digit TOTP code
  username?: string;
}
```

**Step 2 Response:**
```typescript
{
  message: "MFA enabled successfully";
  enabled: true;
}
```

**Error Codes:**
- `400 VALIDATION_ERROR` - Invalid verification code or missing user ID
- `401 AUTH_REQUIRED` - Missing authentication token
- `401 AUTH_INVALID` - Invalid token
- `500 INTERNAL_ERROR` - Cognito error

---

### 4. Export User Data (GDPR Compliance)
**Endpoint:** `GET /users/me/export`
**File:** `/src/backend/lambdas/users/export-data.ts`
**Test File:** `/tests/backend/lambdas/users/export-data.test.ts`

**Features:**
- Exports ALL user data for GDPR compliance
- Uses database stored procedure `export_user_data()`
- Returns downloadable JSON file with proper Content-Disposition header
- Includes user profile, all content, all badges
- Admin users can export any user's data via `/users/{userId}/export`

**Response:**
```typescript
{
  user: User;           // Complete user profile
  content: Content[];   // All user content
  badges: Badge[];      // All user badges
}
```

**Response Headers:**
```
Content-Type: application/json
Content-Disposition: attachment; filename="user-data-{userId}-{timestamp}.json"
```

**Error Codes:**
- `400 VALIDATION_ERROR` - Missing user ID
- `401 AUTH_REQUIRED` - Missing authentication token
- `401 AUTH_INVALID` - Invalid token
- `403 PERMISSION_DENIED` - Non-admin trying to export other user's data
- `404 NOT_FOUND` - User not found
- `500 INTERNAL_ERROR` - Database error

---

### 5. Update Profile
**Endpoint:** `PATCH /users/:id`
**File:** `/src/backend/lambdas/users/update-profile.ts`
**Test File:** `/tests/backend/lambdas/users/update-profile.test.ts`

**Features:**
- Updates username, bio, default visibility, and social links
- Validates username uniqueness using UserRepository
- Auto-generates profile slug from username
- Partial updates supported (only provided fields are updated)
- Validates username format and length

**Request Body:**
```typescript
{
  username?: string;           // 3-30 chars, alphanumeric + underscore
  bio?: string;                // Max 500 chars, can be empty string to clear
  defaultVisibility?: Visibility; // 'private' | 'aws_only' | 'aws_community' | 'public'
  socialLinks?: SocialLinks;   // Optional URLs for twitter, linkedin, github, website
}
```

**Response:**
```typescript
{
  message: "Profile updated successfully";
  user: {
    id: string;
    username: string;
    profileSlug: string;
    bio?: string;
    defaultVisibility: Visibility;
    socialLinks?: SocialLinks;
    updatedAt: Date;
  };
}
```

**Error Codes:**
- `400 VALIDATION_ERROR` - Invalid input, missing fields, or format errors
- `401 AUTH_REQUIRED` - Missing authentication token
- `401 AUTH_INVALID` - Invalid token
- `403 PERMISSION_DENIED` - Attempting to update another user's profile
- `404 NOT_FOUND` - User not found
- `409 DUPLICATE_RESOURCE` - Username already taken
- `500 INTERNAL_ERROR` - Database error

---

### 6. Delete Account
**Endpoint:** `DELETE /users/me`
**File:** `/src/backend/lambdas/users/delete-account.ts`
**Test File:** `/tests/backend/lambdas/users/delete-account.test.ts`

**Features:**
- Complete account deletion from both Cognito and database
- Uses database stored procedure `delete_user_data()` for cascading deletes
- Logs deletion for audit trail (userId, email, username, deletedBy, timestamp)
- Admin users can delete any account by targeting `/users/{userId}`
- Continues with database deletion even if Cognito deletion fails (prevents orphaned data)

**Response:**
```typescript
{
  message: "Account deleted successfully"
}
```

**Deletion Process:**
1. Verify user exists in database
2. Log deletion details for audit trail
3. Delete user from AWS Cognito (using access token)
4. Delete user data from database (cascades to all related tables)
5. Verify deletion completed successfully

**Error Codes:**
- `400 VALIDATION_ERROR` - Missing user ID
- `401 AUTH_REQUIRED` - Missing authentication token
- `401 AUTH_INVALID` - Invalid token
- `403 PERMISSION_DENIED` - Non-admin trying to delete other user's account
- `404 NOT_FOUND` - User not found
- `500 INTERNAL_ERROR` - Database deletion failure

---

## Common Patterns Across All Endpoints

### 1. Authentication & Authorization
All endpoints follow the same authentication pattern:
```typescript
// Extract token from Authorization header
const accessToken = extractTokenFromHeader(event.headers.Authorization);

// Verify token and get user
const verificationResult = await verifyJwtToken(accessToken, tokenConfig, userRepository);

// Check permissions (user can only modify their own data, unless admin)
if (authenticatedUser.id !== userId && !authenticatedUser.isAdmin) {
  return createErrorResponse(403, 'PERMISSION_DENIED', '...');
}
```

### 2. Error Handling
All endpoints use standardized error responses:
```typescript
return createErrorResponse(
  statusCode: number,
  errorCode: string,
  message: string,
  details?: Record<string, any>
);
```

### 3. Input Validation
Each endpoint validates inputs before processing:
- Required fields check
- Type validation
- Format validation
- Business logic validation (e.g., password complexity)

### 4. Database Connection
All endpoints use a shared database pool pattern:
```typescript
let pool: Pool | null = null;

function getDbPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}
```

### 5. CORS Headers
All responses include proper CORS headers via `createSuccessResponse()` and `createErrorResponse()` utilities.

---

## Test Coverage

Each endpoint has comprehensive test coverage including:

### Test Categories:
1. **Validation Tests**
   - Missing required fields
   - Invalid data types
   - Format validation
   - Business logic validation

2. **Success Cases**
   - Happy path scenarios
   - Partial updates
   - Multiple field updates
   - Edge cases (empty strings, null values)

3. **Error Handling**
   - Authentication errors
   - Authorization errors
   - Database errors
   - External service errors (Cognito)
   - Unexpected errors

4. **Security Tests**
   - Permission checks
   - User isolation
   - Admin privileges

### Test Files:
- `/tests/backend/lambdas/users/change-password.test.ts` - 12 test cases
- `/tests/backend/lambdas/users/update-preferences.test.ts` - 11 test cases
- `/tests/backend/lambdas/users/setup-mfa.test.ts` - 10 test cases
- `/tests/backend/lambdas/users/export-data.test.ts` - 10 test cases
- `/tests/backend/lambdas/users/update-profile.test.ts` - 15 test cases
- `/tests/backend/lambdas/users/delete-account.test.ts` - 12 test cases

**Total: 70 test cases**

---

## Dependencies

### New Dependencies Added:
```json
{
  "dependencies": {
    "qrcode": "^1.5.3"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.2"
  }
}
```

### AWS SDK Dependencies:
All endpoints use the following AWS SDK packages:
- `@aws-sdk/client-cognito-identity-provider` - For Cognito operations
- `pg` - For PostgreSQL database operations

---

## Integration with Frontend

All endpoints are ready for integration with the frontend components:

1. **Profile Settings Page** (`/src/frontend/app/profile/page.tsx`)
   - Uses `PATCH /users/:id` for profile updates
   - Uses `PATCH /users/:id/preferences` for email preferences

2. **Security Settings Page** (to be created)
   - Uses `POST /users/:id/password` for password changes
   - Uses `POST /users/:id/mfa/setup` for MFA setup

3. **Data Export Feature** (to be added to profile page)
   - Uses `GET /users/:id/export` for GDPR data export

4. **Account Deletion** (to be added to profile page)
   - Uses `DELETE /users/:id` for account deletion

---

## API Gateway Configuration

To expose these endpoints, add the following routes to your API Gateway configuration:

```typescript
// CDK Stack Configuration
const usersApi = api.root.addResource('users');
const userResource = usersApi.addResource('{id}');

// Change Password
const passwordResource = userResource.addResource('password');
passwordResource.addMethod('POST', new apigateway.LambdaIntegration(changePasswordLambda));

// Update Preferences
const preferencesResource = userResource.addResource('preferences');
preferencesResource.addMethod('PATCH', new apigateway.LambdaIntegration(updatePreferencesLambda));

// MFA Setup
const mfaResource = userResource.addResource('mfa');
const mfaSetupResource = mfaResource.addResource('setup');
mfaSetupResource.addMethod('POST', new apigateway.LambdaIntegration(setupMfaLambda));

// Export Data
const exportResource = userResource.addResource('export');
exportResource.addMethod('GET', new apigateway.LambdaIntegration(exportDataLambda));

// Update Profile
userResource.addMethod('PATCH', new apigateway.LambdaIntegration(updateProfileLambda));

// Delete Account
userResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteAccountLambda));
```

---

## Database Requirements

The following database stored procedures are required:

### 1. `export_user_data(user_id UUID)`
Returns complete user data export including:
- User profile from `users` table
- All content from `content` table
- All badges from `user_badges` table
- All channels from `channels` table (if needed)

### 2. `delete_user_data(user_id UUID)`
Performs cascading deletion of all user data:
- Deletes from `user_badges`
- Deletes from `content`
- Deletes from `channels`
- Deletes from `users`
- Returns boolean success status

**Note:** These stored procedures should already exist based on the UserRepository implementation.

---

## Environment Variables Required

```bash
# AWS Cognito Configuration
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_REGION=us-east-1

# Database Configuration
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# AWS Region
AWS_REGION=us-east-1
```

---

## Security Considerations

1. **Authentication**
   - All endpoints require valid JWT token in Authorization header
   - Token verification uses AWS Cognito UserPool

2. **Authorization**
   - Users can only modify their own data
   - Admin users have elevated privileges for some operations (export, delete)

3. **Password Security**
   - Strong password requirements enforced
   - Password changes require current password verification
   - Passwords handled by AWS Cognito (never stored in application database)

4. **MFA Security**
   - Two-step verification process
   - TOTP codes expire after use
   - QR codes generated server-side to prevent tampering

5. **Data Export**
   - Proper Content-Disposition headers for download
   - Audit logging for compliance
   - Only authorized users can export data

6. **Account Deletion**
   - Comprehensive audit logging
   - Cascading deletes prevent orphaned data
   - Irreversible operation with proper warnings (to be added in frontend)

---

## Next Steps

1. **CDK Stack Updates**
   - Add Lambda function definitions for all 6 endpoints
   - Configure API Gateway routes
   - Set up appropriate IAM roles

2. **Frontend Integration**
   - Update profile settings page to use new endpoints
   - Create security settings page
   - Add data export functionality
   - Add account deletion with confirmation dialog

3. **Documentation**
   - Add OpenAPI/Swagger definitions
   - Update API documentation
   - Create user guides for new features

4. **Monitoring**
   - Add CloudWatch metrics for all endpoints
   - Set up alarms for error rates
   - Track MFA adoption rates

---

## Summary

All 6 user settings endpoints have been successfully implemented with:
- ✅ Proper authentication and authorization
- ✅ Comprehensive input validation
- ✅ Standardized error handling
- ✅ Integration with AWS Cognito
- ✅ Database operations using UserRepository
- ✅ 70 comprehensive test cases
- ✅ GDPR compliance (data export and deletion)
- ✅ MFA support with QR code generation
- ✅ Audit logging for sensitive operations
- ✅ Security best practices

The implementation follows all existing patterns in the codebase and adheres to the API error standards documented in `/docs/api-errors.md`.
