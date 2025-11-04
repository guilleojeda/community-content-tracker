import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const repoRoot = path.resolve(__dirname, '..', '..');

const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');

describe('Repository scaffolding', () => {
const requiredFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'CODE_OF_CONDUCT.md',
  '.env.example',
  '.gitignore',
  '.github/settings.yml',
  'scripts/first-time-setup.sh',
];

  it('includes foundational files specified in Sprint 1 acceptance criteria', () => {
    requiredFiles.forEach((file) => {
      const filePath = path.join(repoRoot, file);
      expect(fs.existsSync(filePath)).toBe(true);
      const stats = fs.statSync(filePath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  it('repository structure matches documented layout', () => {
    const requiredDirectories = [
      'src/backend',
      'src/frontend',
      'src/shared',
      'src/infrastructure',
      'docs',
      'scripts',
      'tests',
    ];

    requiredDirectories.forEach((dir) => {
      const dirPath = path.join(repoRoot, dir);
      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });
  });

  it('gitignore covers node and environment artefacts', () => {
    const content = read('.gitignore');
    expect(content).toMatch(/node_modules\//);
    expect(content).toMatch(/\.env/);
  });

  it('enforces branch protection through repository settings', () => {
    const settingsRaw = read('.github/settings.yml');
    const settings = yaml.load(settingsRaw) as Record<string, any>;
    const branches = settings?.branches ?? [];
    const mainProtection = branches.find((branch: any) => branch?.name === 'main');
    expect(mainProtection).toBeDefined();
    expect(mainProtection.protection?.required_pull_request_reviews?.required_approving_review_count).toBeGreaterThanOrEqual(1);
    expect(mainProtection.protection?.required_status_checks?.contexts).toEqual(expect.arrayContaining(['lint', 'test', 'build']));
    expect(mainProtection.protection?.allow_force_pushes).toBe(false);
  });

  it('README contains project overview and setup instructions', () => {
    const content = read('README.md');
    expect(content).toMatch(/AWS Community Content Hub/i);
    expect(content).toMatch(/Getting Started/i);
  });

  it('LICENSE file contains an approved license notice', () => {
    const content = read('LICENSE').toLowerCase();
    const isMit = content.includes('mit license');
    const isApache = content.includes('apache license') && content.includes('version 2.0');
    expect(isMit || isApache).toBe(true);
  });

  it('CONTRIBUTING guide documents code of conduct and workflow expectations', () => {
    const content = read('CONTRIBUTING.md');
    expect(content).toMatch(/Code of Conduct/i);
    expect(content).toMatch(/Development Process/i);
  });
});

describe('Sprint 1 developer documentation', () => {
  it('local development guide covers prerequisites and database setup', () => {
    const content = read('docs/setup/local-development.md');
    expect(content).toMatch(/Local Development Setup Guide/i);
    expect(content).toMatch(/docker-compose up -d postgres/i);
    expect(content).toMatch(/npm run db:migrate/i);
    expect(content).toMatch(/cp \.env\.example \.env/i);
  });

  it('aws prerequisites guide explains account configuration requirements', () => {
    const content = read('docs/setup/aws-prerequisites.md');
    expect(content).toMatch(/AWS Prerequisites/i);
    expect(content).toMatch(/AWS Account Requirements/i);
    expect(content).toMatch(/aws configure --profile/i);
  });

  it('troubleshooting guide enumerates common setup issues', () => {
    const content = read('docs/setup/troubleshooting.md');
    expect(content).toMatch(/Troubleshooting Guide/i);
    expect(content).toMatch(/Installation Issues/i);
    expect(content).toMatch(/Database Issues/i);
  });

  it('database migration guide documents commands for applying migrations', () => {
    const content = read('docs/setup/database-migrations.md');
    expect(content).toMatch(/Database Migrations Guide/i);
    expect(content).toMatch(/node-pg-migrate/i);
    expect(content).toMatch(/npm run db:migrate/i);
  });

  it('environment template exposes required AWS and database variables', () => {
    const content = read('.env.example');
    expect(content).toMatch(/AWS_REGION=/);
    expect(content).toMatch(/DB_HOST=/);
    expect(content).toMatch(/STACK_NAME=/);
  });

  it('vs code recommendations include aws toolkit and postgres helpers', () => {
    const content = read('.vscode/extensions.json');
    expect(content).toMatch(/amazonwebservices\.aws-toolkit-vscode/);
    expect(content).toMatch(/ms-ossdata\.vscode-postgresql/);
  });

  it('first-time setup script guides users through prerequisites and validation', () => {
    const content = read('scripts/first-time-setup.sh');
    expect(content).toMatch(/First Time Setup Script/i);
    expect(content).toMatch(/check_prerequisites/);
    expect(content).toMatch(/validate_setup/);
  });
});
