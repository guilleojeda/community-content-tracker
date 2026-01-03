const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value.trim();
};

export const appEnvironment = requireEnv('NEXT_PUBLIC_ENVIRONMENT').toLowerCase();

export const betaFeaturesEnabled =
  requireEnv('NEXT_PUBLIC_ENABLE_BETA_FEATURES').toLowerCase() === 'true';

export const feedbackUrl = requireEnv('NEXT_PUBLIC_FEEDBACK_URL');

export const isBetaEnvironment = appEnvironment === 'beta';

export function isBetaModeActive(): boolean {
  return betaFeaturesEnabled || isBetaEnvironment;
}
