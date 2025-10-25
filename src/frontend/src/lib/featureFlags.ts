export const appEnvironment =
  process.env.NEXT_PUBLIC_ENVIRONMENT?.toLowerCase() ?? 'development';

export const betaFeaturesEnabled =
  (process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES ?? 'false').toLowerCase() === 'true';

export const feedbackUrl =
  process.env.NEXT_PUBLIC_FEEDBACK_URL ?? 'https://awscommunityhub.org/beta-feedback';

export const isBetaEnvironment = appEnvironment === 'beta';

export function isBetaModeActive(): boolean {
  return betaFeaturesEnabled || isBetaEnvironment;
}
