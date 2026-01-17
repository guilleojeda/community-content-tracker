import { test, expect } from '@playwright/test';
import { BadgeType, ContentType } from '../../../src/shared/types';

const contentTypes = Object.values(ContentType);
const PROJECT_ORDER = ['chromium', 'firefox', 'webkit'];
const UNCLAIMED_CONTENT_TYPES: ContentType[] = [
  ContentType.BLOG,
  ContentType.YOUTUBE,
  ContentType.GITHUB,
  ContentType.CONFERENCE_TALK,
  ContentType.PODCAST,
];
const BADGE_TYPES: BadgeType[] = [
  BadgeType.COMMUNITY_BUILDER,
  BadgeType.HERO,
  BadgeType.AMBASSADOR,
  BadgeType.USER_GROUP_LEADER,
];
const BADGE_LABELS: Record<BadgeType, string> = {
  [BadgeType.COMMUNITY_BUILDER]: 'Community Builder',
  [BadgeType.HERO]: 'Hero',
  [BadgeType.AMBASSADOR]: 'Ambassador',
  [BadgeType.USER_GROUP_LEADER]: 'User Group Leader',
};

const normalizeProjectName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const getProjectConfig = (projectName: string) => {
  const slug = normalizeProjectName(projectName || 'default');
  const index = Math.max(PROJECT_ORDER.indexOf(slug), 0);
  const unclaimedContentType = UNCLAIMED_CONTENT_TYPES[index % UNCLAIMED_CONTENT_TYPES.length];
  const badgeType = BADGE_TYPES[index % BADGE_TYPES.length];

  return {
    slug,
    testToken: `test-token-${slug}`,
    adminToken: `admin-token-${slug}`,
    unclaimedContentType,
    unclaimedTitle: `Unclaimed ${slug} ${unclaimedContentType}`,
    badgeType,
    badgeLabel: BADGE_LABELS[badgeType],
  };
};

const withAuthToken = async (page: any, token = 'test-token') => {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem('accessToken', value);
    window.localStorage.setItem('cookie-consent', 'accepted');
  }, token);
};

const setupConsent = async (page: any) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('cookie-consent', 'accepted');
  });
};

test.describe('Sprint 8 E2E flows', () => {
  test.beforeEach(async ({ page }) => {
    await setupConsent(page);
  });

  test('user registration and verification flow', async ({ page }) => {
    const { slug } = getProjectConfig(test.info().project.name);
    const uniqueSuffix = `${Date.now()}-${test.info().workerIndex}`;
    const email = `creator-${slug}-${uniqueSuffix}@example.com`;
    const username = `power_creator_${slug}_${uniqueSuffix}`;

    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('#email');
    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');
    const confirmPasswordInput = page.locator('#confirmPassword');

    await usernameInput.fill(username);
    await passwordInput.fill('StrongPassword123!');
    await confirmPasswordInput.fill('StrongPassword123!');
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByRole('checkbox').check();

    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Registration successful')).toBeVisible();

    await page.waitForURL(/\/auth\/verify-email/);
    await page.getByLabel('Verification Code').fill('123456');
    await page.getByRole('button', { name: 'Verify Email' }).click();
    await expect(page.getByText('Email verified successfully')).toBeVisible();
  });

  test('anonymous search flow shows public results', async ({ page }) => {
    await page.goto('/search?q=lambda');

    await expect(page.getByText('AWS Lambda Deep Dive')).toBeVisible();
    await expect(page.getByText('Want to see more content?')).toBeVisible();
  });

  test('authenticated creator flows: content, channels, claiming, search', async ({ page }) => {
    test.slow();
    const project = getProjectConfig(test.info().project.name);
    await withAuthToken(page, project.testToken);

    await page.goto('/dashboard/content');
    await expect(page.getByRole('heading', { name: 'Content Management' })).toBeVisible();

    for (const type of contentTypes) {
      const title = `Content ${type}`;
      await page.getByRole('button', { name: 'Add Content' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.locator('#title').fill(title);
      await dialog.locator('#contentType').selectOption(type);
      await dialog.locator('#visibility').selectOption('public');
      await dialog.getByLabel('URL').first().fill(`https://example.com/${type}`);
      await dialog.locator('#tags').fill(`${type}-tag`);
      await dialog.getByRole('button', { name: 'Create' }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }

    await page.goto('/dashboard/channels');
    await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Channel' }).click();
    await expect(page.getByRole('heading', { name: 'Add New Channel' })).toBeVisible();
    await page.locator('#channelType').selectOption('blog');
    await page.locator('#url').fill('https://example.com/rss.xml');
    await page.locator('#name').fill('Creator Feed');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Channel added successfully')).toBeVisible();
    await expect(page.getByText('Creator Feed')).toBeVisible();

    await page.getByRole('button', { name: 'Sync' }).click();
    await expect(page.getByText('Sync started successfully')).toBeVisible();

    await page.goto('/dashboard/claim-content');
    await expect(page.getByRole('heading', { name: 'Claim Content' })).toBeVisible();
    await page.getByLabel('Content Type').selectOption(project.unclaimedContentType);
    await expect(page.getByText(project.unclaimedTitle)).toBeVisible();
    await page.getByRole('button', { name: 'Claim', exact: true }).first().click();
    await expect(page.getByText('Confirm Claim')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Successfully claimed content')).toBeVisible();

    await page.goto('/dashboard/search?q=Lambda');
    await expect(page.getByText('AWS Lambda Deep Dive')).toBeVisible();
  });

  test('admin badge granting flow', async ({ page }) => {
    const project = getProjectConfig(test.info().project.name);
    await withAuthToken(page, project.adminToken);

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    await page.getByRole('row', { name: new RegExp(`builder-${project.slug}`, 'i') }).click();
    await expect(page.getByText('Username:')).toBeVisible();

    await page.getByRole('button', { name: 'Grant Badge' }).click();
    await page.locator('#modal-badge-type').selectOption(project.badgeType);
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Badge granted successfully.')).toBeVisible();
    await expect(page.locator('li', { hasText: project.badgeLabel })).toBeVisible();
  });

  test('program exports and GDPR data flows', async ({ page }) => {
    const project = getProjectConfig(test.info().project.name);
    await withAuthToken(page, project.testToken);

    await page.goto('/dashboard/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics Dashboard' })).toBeVisible();

    const programSection = page.getByRole('heading', { name: 'Program Export' }).locator('..');
    const programSelect = programSection.locator('select');
    const exportButton = programSection.getByRole('button', { name: 'Export Program CSV' });

    const programs = ['community_builder', 'hero', 'ambassador', 'user_group_leader'];

    for (const program of programs) {
      await programSelect.selectOption(program);
      const [response] = await Promise.all([
        page.waitForResponse((resp) =>
          resp.url().endsWith('/export/csv') && resp.request().method() === 'POST'
        ),
        exportButton.click(),
      ]);

      const payload = await response.request().postDataJSON();
      expect(payload.programType).toBe(program);
      await expect(page.getByText('Program-specific CSV exported successfully.')).toBeVisible();
    }

    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/users/') && resp.url().endsWith('/export') && resp.request().method() === 'GET'
      ),
      page.getByRole('button', { name: 'Export My Data' }).click(),
    ]);

    page.once('dialog', (dialog) => dialog.accept());

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/users/') && resp.request().method() === 'DELETE'
      ),
      page.getByRole('button', { name: 'Delete My Account' }).click(),
    ]);

    await page.waitForURL(/\/$/);
    await expect(page.getByText('Discover AWS Community Content')).toBeVisible();
  });
});
