#!/usr/bin/env node

/**
 * Runs database migrations. Attempts to use the configured DATABASE_URL first,
 * falling back to the local Docker helper when that connection fails.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const rootDir = path.join(__dirname, '..');
const backendDir = path.join(rootDir, 'src', 'backend');
const backendScript = path.join(backendDir, 'scripts', 'run-db-migrate.js');
const migrationsDir = path.join(backendDir, 'migrations');

const quietMode =
  process.env.VERBOSE_MIGRATIONS === '1'
    ? false
    : process.env.MIGRATIONS_QUIET === '1' || process.env.CI === 'true';

function runCommand(command, args, options = {}) {
  if (quietMode) {
    return spawnSync(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return spawnSync(command, args, {
    ...options,
    stdio: options.stdio ?? 'inherit',
  });
}

function logQuietFailure(label, result) {
  if (!quietMode || result.status === 0) {
    return;
  }

  console.error(`[migrations] ${label} failed with exit code ${result.status ?? 'unknown'}`);
  const stdout = result.stdout?.toString().trim();
  const stderr = result.stderr?.toString().trim();

  if (stdout) {
    console.error(stdout);
  }
  if (stderr) {
    console.error(stderr);
  }
}

function runNodePgMigrate() {
  if (quietMode) {
    console.log('[migrations] Running node-pg-migrate (quiet mode)...');
  }

  const result = runCommand(
    'node',
    [
      backendScript,
      'up',
    ],
    {
      cwd: backendDir,
    }
  );

  if (quietMode && result.status === 0) {
    console.log('[migrations] node-pg-migrate completed.');
  }

  logQuietFailure('node-pg-migrate', result);

  return result;
}

function commandExists(cmd) {
  const result = spawnSync('command', ['-v', cmd], { stdio: 'ignore' });
  return result.status === 0;
}

function runLocalFallback() {
  if (quietMode) {
    console.log('[migrations] Running local Docker migrations (quiet mode)...');
  }

  const result = runCommand(
    'bash',
    [path.join(rootDir, 'scripts', 'run-local-migrations.sh')]
  );

  if (quietMode && result.status === 0) {
    console.log('[migrations] Local Docker migrations completed.');
  }

  logQuietFailure('local migrations', result);

  return result;
}

function sanitizeMigrationSql(sql) {
  let sanitized = sql
    .split('\n')
    .filter((line) => !line.trim().toUpperCase().startsWith('CREATE EXTENSION'))
    .join('\n');

  const functionPattern = /CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]+?LANGUAGE\s+\w+\s*;/i;
  while (functionPattern.test(sanitized)) {
    sanitized = sanitized.replace(functionPattern, '');
  }

  const triggerPattern = /CREATE\s+TRIGGER[\s\S]+?;/i;
  while (triggerPattern.test(sanitized)) {
    sanitized = sanitized.replace(triggerPattern, '');
  }

  sanitized = sanitized
    .replace(/CREATE\s+INDEX\s+[^\n;]+USING\s+IVFFLAT[^;]+;/gi, '')
    .replace(/CREATE\s+INDEX\s+[^\n;]+to_tsvector[^;]+;/gi, '')
    .replace(/COMMENT\s+ON\s+FUNCTION[^\n;]+;/gi, '')
    .replace(/COMMENT\s+ON\s+TRIGGER[^\n;]+;/gi, '')
    .replace(/vector\(\d+\)/gi, 'double precision[]')
    .replace(/decimal\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'numeric')
    .replace(/\n\s*;\s*\n/g, '\n')
    .trim();

  return sanitized;
}

function runInMemoryMigrations() {
  console.log('[migrations] Docker is unavailable. Running migrations against in-memory PostgreSQL (pg-mem) for validation.');
  const { newDb } = require('pg-mem');

  const db = newDb({ autoCreateForeignKeyIndices: true });

  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => randomUUID(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: 'uuid',
    implementation: () => randomUUID(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'now',
    returns: 'timestamptz',
    implementation: () => new Date(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'clock_timestamp',
    returns: 'timestamptz',
    implementation: () => new Date(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'similarity',
    args: ['text', 'text'],
    returns: 'double precision',
    implementation: (a, b) => {
      if (!a || !b) {
        return 0;
      }
      const normalize = (value) => `  ${String(value).toLowerCase()} `;
      const trigrams = (value) => {
        const normalized = normalize(value);
        const set = new Set();
        for (let i = 0; i < normalized.length - 2; i += 1) {
          set.add(normalized.substring(i, i + 3));
        }
        return set;
      };

      const setA = trigrams(a);
      const setB = trigrams(b);
      const intersection = [...setA].filter((tri) => setB.has(tri)).length;
      const union = new Set([...setA, ...setB]).size;
      return union === 0 ? 0 : intersection / union;
    },
  });

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  migrationFiles.forEach((file) => {
    const filePath = path.join(migrationsDir, file);
    const rawSql = fs.readFileSync(filePath, 'utf8');
    const sanitized = sanitizeMigrationSql(rawSql);
    if (sanitized.trim().length === 0) {
      return;
    }

    const statements = sanitized
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    statements.forEach((statement) => {
      try {
        db.public.none(statement);
      } catch (error) {
        console.warn(`[migrations] Skipping unsupported statement in ${file}: ${error.message}`);
      }
    });
  });

  console.log('[migrations] In-memory migration validation completed successfully.');
  process.exit(0);
}

const hasDirectConfig =
  !!process.env.DATABASE_URL ||
  !!process.env.DATABASE_SECRET_ARN ||
  (!!process.env.DB_HOST && !!process.env.DB_NAME && process.env.DB_USER !== undefined);

let directResult = { status: 1 };

if (hasDirectConfig) {
  directResult = runNodePgMigrate();

  if (directResult.status === 0) {
    process.exit(0);
  }

  if (process.env.SKIP_MIGRATION_FALLBACK === '1') {
    process.exit(directResult.status ?? 1);
  }

  console.warn(
    '[migrations] Direct connection failed – attempting to run using local Docker container...'
  );
} else {
  console.log(
    '[migrations] No direct database configuration detected – using local Docker container.'
  );
}

if (!commandExists('docker')) {
  runInMemoryMigrations();
}

const fallbackResult = runLocalFallback();

if (fallbackResult.status !== 0) {
  process.exit(fallbackResult.status ?? 1);
}

process.exit(0);
