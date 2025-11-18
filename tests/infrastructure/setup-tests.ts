import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_OUT_DIR = path.resolve(process.cwd(), '../frontend/out');

function ensureFrontendBuildArtifacts(): void {
  if (fs.existsSync(FRONTEND_OUT_DIR)) {
    return;
  }

  fs.mkdirSync(FRONTEND_OUT_DIR, { recursive: true });
  const indexMarkup = '<!doctype html><html><head><meta charset="utf-8"><title>AWS Community Content Hub</title></head><body><h1>Static export placeholder</h1></body></html>';
  const errorMarkup = '<!doctype html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Something went wrong</h1></body></html>';

  fs.writeFileSync(path.join(FRONTEND_OUT_DIR, 'index.html'), indexMarkup, { encoding: 'utf-8' });
  fs.writeFileSync(path.join(FRONTEND_OUT_DIR, 'error.html'), errorMarkup, { encoding: 'utf-8' });
}

ensureFrontendBuildArtifacts();
