import { test, expect } from '@playwright/test';
import { createMockState, registerApiMocks } from './helpers/mockApi';
import { ContentType } from '../../../src/shared/types';

const contentTypes = Object.values(ContentType);

const withAuthToken = async (page: any, token = 'test-token') => {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem('accessToken', value);
  }, token);
};

const setupMockedPage = async (page: any, state: ReturnType<typeof createMockState>) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('cookie-consent', 'accepted');
  });
  await registerApiMocks(page, state);
};

const buildAdminState = () => {
  const state = createMockState();
  state.currentUser = {
    ...state.currentUser,
    id: 'admin-1',
    email: 'admin@example.com',
    username: 'admin',
    profileSlug: 'admin',
    isAdmin: true,
  };
  return state;
};

test.describe('Sprint 8 E2E flows', () => {
  test('user registration and verification flow', async ({ page }) => {
    const state = createMockState();
    await setupMockedPage(page, state);

    await page.goto('/auth/register');

    await page.getByLabel('Email').fill('creator@example.com');
    await page.getByLabel('Username').fill('power_creator');
    await page.getByLabel('Password', { exact: true }).fill('StrongPassword123!');
    await page.getByLabel('Confirm Password').fill('StrongPassword123!');
    await page.getByRole('checkbox').check();

    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Registration successful')).toBeVisible();

    await page.waitForURL(/\/auth\/verify-email/);
    await page.getByLabel('Verification Code').fill('123456');
    await page.getByRole('button', { name: 'Verify Email' }).click();
    await expect(page.getByText('Email verified successfully')).toBeVisible();
  });

  test('anonymous search flow shows public results', async ({ page }) => {
    const state = createMockState();
    await setupMockedPage(page, state);

    await page.goto('/search?q=lambda');

    await expect(page.getByText('AWS Lambda Deep Dive')).toBeVisible();
    await expect(page.getByText('Want to see more content?')).toBeVisible();
  });

  test('authenticated creator flows: content, channels, claiming, search', async ({ page }) => {
    test.slow();
    const state = createMockState();
    await withAuthToken(page);
    await setupMockedPage(page, state);

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
    await page.getByRole('button', { name: 'Claim', exact: true }).first().click();
    await expect(page.getByText('Confirm Claim')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Successfully claimed content')).toBeVisible();

    await page.goto('/dashboard/search?q=Lambda');
    await expect(page.getByText('AWS Lambda Deep Dive')).toBeVisible();
  });

  test('admin badge granting flow', async ({ page }) => {
    const state = buildAdminState();
    await withAuthToken(page, 'admin-token');
    await setupMockedPage(page, state);

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    await page.getByRole('row', { name: /builder/ }).click();
    await expect(page.getByText('Username:')).toBeVisible();

    await page.getByRole('button', { name: 'Grant Badge' }).click();
    await page.locator('#modal-badge-type').selectOption('community_builder');
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Badge granted successfully.')).toBeVisible();
    await expect(page.locator('li', { hasText: 'Community Builder' })).toBeVisible();
  });

  test('program exports and GDPR data flows', async ({ page }) => {
    const state = createMockState();
    await withAuthToken(page);
    await setupMockedPage(page, state);

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
        resp.url().includes('/api/users/') && resp.url().endsWith('/export') && resp.request().method() === 'GET'
      ),
      page.getByRole('button', { name: 'Export My Data' }).click(),
    ]);

    page.once('dialog', (dialog) => dialog.accept());

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/users/') && resp.request().method() === 'DELETE'
      ),
      page.getByRole('button', { name: 'Delete My Account' }).click(),
    ]);

    await page.waitForURL(/\/$/);
    await expect(page.getByText('Discover AWS Community Content')).toBeVisible();
  });
});
