export interface AuthorizerPayload {
  userId?: string;
  username?: string;
  email?: string;
  isAdmin?: boolean | string;
  isAwsEmployee?: boolean | string;
  claims?: Record<string, unknown>;
  groups?: string[] | string;
}

export interface ResolvedAuthorizerContext {
  userId?: string;
  username?: string;
  email?: string;
  isAdmin: boolean;
  isAwsEmployee: boolean;
}

const parseGroups = (rawGroups: unknown): string[] => {
  if (!rawGroups) {
    return [];
  }

  if (Array.isArray(rawGroups)) {
    return rawGroups.map((entry) => String(entry));
  }

  if (typeof rawGroups === 'string') {
    try {
      const parsed = JSON.parse(rawGroups);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry));
      }
    } catch {
      // Fall through to comma parsing.
    }

    return rawGroups
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

const toBoolean = (value: unknown): boolean => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return false;
};

export const resolveAuthorizerContext = (
  authorizer: AuthorizerPayload | null | undefined
): ResolvedAuthorizerContext => {
  const claims = (authorizer && typeof authorizer === 'object' && authorizer.claims && typeof authorizer.claims === 'object')
    ? authorizer.claims
    : {};

  const userId =
    authorizer?.userId
    ?? (claims as any).sub
    ?? (claims as any)['cognito:username']
    ?? (claims as any).username;

  const username =
    authorizer?.username
    ?? (claims as any).username
    ?? (claims as any)['cognito:username'];

  const email =
    authorizer?.email
    ?? (claims as any).email;

  const adminFlag =
    authorizer?.isAdmin
    ?? (claims as any)['custom:is_admin']
    ?? (claims as any).isAdmin;

  const awsEmployeeFlag =
    authorizer?.isAwsEmployee
    ?? (claims as any)['custom:is_aws_employee']
    ?? (claims as any).isAwsEmployee;

  const groups = parseGroups((claims as any)['cognito:groups'] ?? authorizer?.groups);
  const isAdmin = toBoolean(adminFlag)
    || groups.some((group) => group.toLowerCase() === 'admin' || group.toLowerCase() === 'admins');

  const isAwsEmployee = toBoolean(awsEmployeeFlag);

  return {
    userId,
    username,
    email,
    isAdmin,
    isAwsEmployee,
  };
};
