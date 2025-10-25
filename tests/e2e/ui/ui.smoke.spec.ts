import { test, expect } from '@playwright/test';

const routes = ['/', '/dashboard/', '/search/'];

test.describe('Static UI smoke tests', () => {
  for (const path of routes) {
    test(`serves ${path}`, async ({ baseURL, request }) => {
      expect(baseURL).toBeTruthy();
      const response = await request.get(path);
      expect(response.ok()).toBeTruthy();
      const html = await response.text();
      expect(html).toContain('<html');
      expect(html).toMatch(/AWS Community Hub/i);
    });
  }

  test('cookie consent banner is present', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toMatch(/We use cookies/i);
  });
});
