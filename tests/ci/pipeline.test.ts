import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as core from '@actions/core';
import { handlePipelineResult } from '../../src/backend/utils/pipeline';

const repoRoot = path.resolve(__dirname, '..', '..');

const loadWorkflow = (relativePath: string) => {
  const workflowPath = path.join(repoRoot, relativePath);
  const raw = fs.readFileSync(workflowPath, 'utf-8');
  try {
    return yaml.load(raw) as Record<string, any>;
  } catch (error) {
    const stripScriptBlocks = (text: string): string => {
      const lines = text.split('\n');
      const result: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const scriptMatch = line.match(/^(\s*)script:\s*\|/);
        if (!scriptMatch) {
          result.push(line);
          continue;
        }

        const indentLength = scriptMatch[1].length;
        result.push(`${scriptMatch[1]}script: ""`);

        i += 1;
        while (i < lines.length) {
          const candidate = lines[i];
          const trimmed = candidate.trim();
          const candidateIndent = candidate.match(/^(\s*)/)?.[1].length ?? 0;

          if (trimmed.length === 0) {
            i += 1;
            continue;
          }

          const isNextKey = /^\s*(?:-\s+name:|[a-zA-Z][A-Za-z0-9_-]*\s*:)/.test(candidate);
          if (candidateIndent <= indentLength && isNextKey) {
            // The block has ended; re-process this line in the outer loop
            i -= 1;
            break;
          }

          i += 1;
        }
      }

      return result.join('\n');
    };

    const sanitized = stripScriptBlocks(raw.replace(/\*\*/g, '__'));
    return yaml.load(sanitized) as Record<string, any>;
  }
};

const hasRunSnippet = (job: any, snippet: string) =>
  (job?.steps ?? []).some(
    (step: any) => typeof step?.run === 'string' && step.run.includes(snippet)
  );

const hasActionUsage = (job: any, action: string, predicate?: (step: any) => boolean) =>
  (job?.steps ?? []).some((step: any) => {
    if (step?.uses !== action) {
      return false;
    }
    return predicate ? predicate(step) : true;
  });

const hasCacheForPath = (job: any, pathFragment: string) =>
  hasActionUsage(job, 'actions/cache@v3', (step) => {
    const cachePath = step?.with?.path;
    return typeof cachePath === 'string' && cachePath.includes(pathFragment);
  });

const loadWorkflowText = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');

const getStepByName = (job: any, name: string) =>
  (job?.steps ?? []).find((step: any) => step?.name === name);

const toArray = (value: any) => {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
};

describe('CI workflow configuration', () => {
  const workflow = loadWorkflow('.github/workflows/ci.yml');
  const jobs = workflow.jobs;

  it('triggers on pull requests to main and develop with required path exclusions', () => {
    expect(workflow.on?.pull_request?.branches).toEqual(expect.arrayContaining(['main', 'develop']));
    const ignored = workflow.on?.pull_request?.['paths-ignore'];
    expect(ignored).toEqual(expect.arrayContaining(['**.md', '.gitignore', 'LICENSE']));
  });

  it('defines required jobs with proper dependencies', () => {
    expect(Object.keys(jobs)).toEqual(
      expect.arrayContaining([
        'setup',
        'lint',
        'test',
        'security-scan',
        'build',
        'integration-tests',
        'validate-pr',
      ])
    );

    const lintJob = jobs['lint'];
    expect(lintJob.needs).toBe('setup');
    expect(lintJob.if).toContain('needs.setup.result == \'success\'');

    const validateJob = jobs['validate-pr'];
    expect(validateJob.needs).toEqual(
      expect.arrayContaining(['setup', 'lint', 'test', 'security-scan', 'build', 'integration-tests'])
    );
  });

  it('runs linting, formatting, and type checking in lint job', () => {
    const lintJob = jobs['lint'];
    expect(hasRunSnippet(lintJob, 'npm run lint')).toBe(true);
    expect(hasRunSnippet(lintJob, 'npx prettier --check')).toBe(true);
    expect(hasRunSnippet(lintJob, 'npm run typecheck')).toBe(true);
  });

  it('executes unit tests with Postgres service and uploads coverage', () => {
    const testJob = jobs['test'];
    expect(testJob.needs).toBe('setup');
    expect(testJob.services?.postgres?.image).toBe('pgvector/pgvector:pg15');
    expect(hasRunSnippet(testJob, 'npm run test')).toBe(true);
    expect(hasActionUsage(testJob, 'codecov/codecov-action@v3')).toBe(true);
  });

  it('builds artifacts only after tests succeed', () => {
    const buildJob = jobs['build'];
    expect(buildJob.needs).toEqual(expect.arrayContaining(['setup', 'test']));
    expect(hasCacheForPath(buildJob, 'src/backend/dist')).toBe(true);
  });

  it('integration tests provision a dedicated Postgres service and run migrations', () => {
    const integrationJob = jobs['integration-tests'];
    expect(integrationJob.needs).toEqual(expect.arrayContaining(['setup', 'build']));
    expect(integrationJob.services?.postgres?.image).toBe('pgvector/pgvector:pg15');
    expect(hasRunSnippet(integrationJob, 'npm run db:migrate')).toBe(true);
    expect(hasRunSnippet(integrationJob, 'npm run test -- --testPathPattern=integration')).toBe(true);
  });

  it('validate-pr job fails if any upstream job fails and reports status comment', () => {
    const validateJob = jobs['validate-pr'];
    expect(hasRunSnippet(validateJob, 'needs.setup.result')).toBe(true);
    expect(hasActionUsage(validateJob, 'actions/github-script@v7')).toBe(true);
  });
});

describe('Deployment workflows', () => {
  it('development workflow deploys automatically for main branch changes and uploads artifacts to S3', () => {
    const devWorkflow = loadWorkflow('.github/workflows/deploy-dev.yml');
    expect(devWorkflow.on?.push?.branches).toEqual(['main']);
    expect(devWorkflow.env?.S3_BUCKET).toBe('${{ secrets.DEV_ARTIFACTS_BUCKET }}');

    const buildJob = devWorkflow.jobs['build-and-test'];
    expect(buildJob.needs).toBe('pre-deploy');

    const archiveStep = getStepByName(buildJob, 'Archive build artifacts');
    expect(archiveStep).toBeDefined();
    expect(archiveStep?.run).toContain('artifacts/');
    expect(/(tar|zip)/.test(archiveStep?.run ?? '')).toBe(true);

    const uploadStep = getStepByName(buildJob, 'Upload build artifacts to S3');
    expect(uploadStep).toBeDefined();
    expect(uploadStep?.run).toContain('aws s3');
    expect(uploadStep?.run).toContain('artifacts/');

    expect(hasRunSnippet(buildJob, 'npx cdk synth --all')).toBe(true);

    const infraJob = devWorkflow.jobs['deploy-infrastructure'];
    expect(infraJob.needs).toEqual(expect.arrayContaining(['build-and-test']));
    expect(hasActionUsage(infraJob, 'aws-actions/configure-aws-credentials@v4')).toBe(true);
    expect(hasRunSnippet(infraJob, 'npx cdk deploy --all --require-approval never --outputs-file outputs.json')).toBe(true);
    expect(hasRunSnippet(infraJob, 'aws s3 cp outputs.json')).toBe(true);
  });

  it('staging workflow enforces manual approval before deployment', () => {
    const stagingWorkflow = loadWorkflow('.github/workflows/deploy-staging.yml');
    const approvalJob = stagingWorkflow.jobs['approval-gate'];
    expect(approvalJob).toBeDefined();
    expect(approvalJob.environment?.name).toBe('staging-approval');
    const approvalNeeds = Array.isArray(approvalJob.needs) ? approvalJob.needs : [approvalJob.needs];
    expect(approvalNeeds).toEqual(expect.arrayContaining(['validate-deployment']));
    expect(approvalJob.if).toContain('should-deploy');
  });

  it('production workflow includes explicit approval and post-deploy health checks', () => {
    const prodWorkflow = loadWorkflow('.github/workflows/deploy-prod.yml');
    const jobs = prodWorkflow.jobs ?? {};

    const businessApproval = jobs['business-approval'];
    expect(businessApproval).toBeDefined();
    expect(businessApproval.environment?.name).toBe('production-business-approval');

    const technicalApproval = jobs['technical-approval'];
    expect(technicalApproval).toBeDefined();
    const technicalNeeds = toArray(technicalApproval?.needs);
    expect(technicalNeeds).toEqual(expect.arrayContaining(['business-approval']));

    const finalApproval = jobs['final-deployment-approval'];
    expect(finalApproval).toBeDefined();
    expect(finalApproval.environment?.name).toBe('production-final-approval');
    const finalNeeds = toArray(finalApproval?.needs);
    expect(finalNeeds).toEqual(
      expect.arrayContaining(['business-approval', 'technical-approval'])
    );

    const healthChecks = jobs['production-health-checks'];
    expect(healthChecks).toBeDefined();
    expect(hasRunSnippet(healthChecks, 'curl -f "${{ env.PROD_URL }}/health"')).toBe(true);
    expect(hasRunSnippet(healthChecks, 'curl -f "${{ env.PROD_URL }}/api/health"')).toBe(true);
  });
});

describe('pipeline utilities', () => {
  it('calls core.setFailed when pipeline result is unsuccessful', () => {
    const spy = jest.spyOn(core, 'setFailed').mockImplementation(() => {});

    const result = handlePipelineResult({ success: false, error: 'TypeScript compilation failed' });

    expect(result.success).toBe(false);
    expect(spy).toHaveBeenCalledWith('TypeScript compilation failed');
    spy.mockRestore();
  });

  it('returns successful results untouched', () => {
    const result = handlePipelineResult({ success: true });
    expect(result).toEqual({ success: true });
  });
});
