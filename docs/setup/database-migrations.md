# Database Migrations Guide

This document explains how to run, create, and troubleshoot database migrations for the AWS Community Content Hub project.  
The project uses [node-pg-migrate](https://github.com/salsita/node-pg-migrate) and the migration scripts defined in `src/backend/package.json`.

---

## 1. Prerequisites

1. **PostgreSQL instance**  
   - For local development, start the Docker container declared in `docker-compose.yml`:
     ```bash
     docker compose up -d postgres
     ```
   - The container now runs the initialization scripts in `scripts/postgres/` automatically, creating the `contentuser` role and ensuring credentials match the defaults in `.env.example`.
   - Wait for `database system is ready to accept connections` in the container logs.

2. **Environment configuration**  
   The migration CLI requires a valid connection string. Provide one of the following:

   - Recommended: set `DATABASE_URL` directly in your environment or `.env` file, e.g.
     ```
     DATABASE_URL=postgresql://contentuser:your-secure-password@localhost:5432/contenthub
     ```
   - Alternatively, define the individual parts and the scripts will assemble the connection string:
     ```
     DB_HOST=localhost
     DB_PORT=5432
     DB_NAME=contenthub
     DB_USER=contentuser
     DB_PASSWORD=your-secure-password
     ```

   > The helper script `src/backend/scripts/ensureDatabaseUrl.js` validates these variables before every migration run. If anything is missing, the command will fail fast with an actionable error message.

3. **Install dependencies**
   ```bash
   npm install
   ```

---

## 2. Running migrations

For a fully automated local run (starts a disposable Docker Postgres instance, applies migrations, and tears it down), use:

```bash
npm run db:migrate:local
```

To reuse an already running container, export `KEEP_DB=1` (and optionally override `DB_PORT`, `DB_USER`, `DB_PASSWORD`, or `DB_NAME` before invoking the command).

If you already have your own Postgres instance available, you can execute the backend workspace scripts directly:

```bash
npm run db:migrate --workspace=src/backend
```

This runs every pending migration in `src/backend/migrations` against the configured database.

Additional commands are available:

```bash
# Re-run the latest migration (useful after rolling back)
npm run migrate:up --workspace=src/backend

# Roll back the most recent migration
npm run migrate:down --workspace=src/backend
```

> All commands automatically load `.env`, derive `DATABASE_URL` when needed, and exit with a non-zero status if the connection cannot be established.

---

## 3. Creating migrations

Use the node-pg-migrate CLI directly via the existing scripts:

```bash
# Create a new migration file (timestamped) inside src/backend/migrations
npm run migrate:create --workspace=src/backend -- --name="add_new_table"
```

Each migration exports `up` and `down` functions:

```typescript
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('example', {
    id: 'id',
    name: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('example');
};
```

Commit both the new migration file and any related schema documentation updates.

---

## 4. Inspecting migration state

To inspect the current status, run node-pg-migrate in dry mode:

```bash
node --require dotenv/config --require ./scripts/ensureDatabaseUrl.js ../../node_modules/.bin/node-pg-migrate \
  status --migrations-dir migrations --dir src/backend
```

This reports which migrations have been applied and which remain pending.

---

## 5. Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `DATABASE_URL is required` | Ensure `DATABASE_URL` or all `DB_*` variables are set before running the command. |
| `password authentication failed` | Confirm the credentials in your environment or recreate the local Docker database. |
| `relation already exists` during `up` | A previous run partially applied the migration. Roll back (`npm run migrate:down`) and rerun. |
| New migrations not picked up in CI | Commit the generated `.sql` files and confirm the workspace command runs successfully on a clean checkout. |

---

## 6. Workflow checklist

1. Start the local Postgres container.
2. Export `DATABASE_URL` (or the individual `DB_*` variables).
3. Run `npm run db:migrate --workspace=src/backend` to apply migrations.
4. After adding a new migration, run backend tests (`npm run test --workspace=src/backend`) to ensure repositories and integration tests pass.
5. Update relevant documentation when the schema changes.

Following this process keeps local environments, CI, and deployed stacks aligned with the canonical schema.*** End Patch
