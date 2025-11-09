/**
 * @jest-environment node
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT_PATH = '../../../src/frontend/scripts/export-static';

describe('static export script', () => {
  const originalRoot = process.env.STATIC_EXPORT_ROOT;

  afterEach(() => {
    process.env.STATIC_EXPORT_ROOT = originalRoot;
    jest.resetModules();
  });

  it('generates placeholder pages and copies public assets', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'export-static-'));
    const publicDir = path.join(tempRoot, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'asset.txt'), 'asset');

    process.env.STATIC_EXPORT_ROOT = tempRoot;

    jest.isolateModules(() => {
      // Requiring the script executes the export logic.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(SCRIPT_PATH);
    });

    const outDir = path.join(tempRoot, 'out');
    const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(indexHtml).toContain('AWS Community Content Hub');
    expect(indexHtml).toContain('cookie-actions');

    const dashboardHtml = fs.readFileSync(path.join(outDir, 'dashboard', 'index.html'), 'utf8');
    expect(dashboardHtml).toContain('Dashboard - AWS Community Content Hub');

    const cssPath = path.join(outDir, 'assets', 'scripts', 'placeholder.css');
    expect(fs.existsSync(cssPath)).toBe(true);

    const copiedAsset = path.join(outDir, 'assets', 'asset.txt');
    expect(fs.existsSync(copiedAsset)).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
