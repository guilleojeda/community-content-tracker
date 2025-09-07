# Database Migrations Guide

This guide covers everything you need to know about database migrations in the AWS Community Content Hub project, including setup, creation, execution, and troubleshooting.

## Overview

The project uses **TypeORM** for database migrations, providing a robust way to version control database schema changes and ensure consistent deployments across environments.

## Table of Contents

- [Database Setup](#database-setup)
- [Migration Commands](#migration-commands)
- [Creating Migrations](#creating-migrations)
- [Running Migrations](#running-migrations)
- [Migration Best Practices](#migration-best-practices)
- [Troubleshooting](#troubleshooting)
- [Production Considerations](#production-considerations)

---

## Database Setup

### Local Development Setup

1. **Start PostgreSQL with Docker**:
   ```bash
   docker-compose up -d postgres
   ```

2. **Verify database is running**:
   ```bash
   docker-compose logs postgres
   # Look for: "database system is ready to accept connections"
   ```

3. **Test database connection**:
   ```bash
   docker-compose exec postgres psql -U contentuser -d contenthub
   ```

### Database Configuration

The migration system uses configuration from your `.env` file:

```bash
# Local Development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=contenthub
DB_USER=contentuser
DB_PASSWORD=your-secure-password
DB_SSL=false

# Production (AWS RDS)
# These will be automatically configured by CDK deployment
```

### TypeORM Configuration

Migration settings are defined in `src/backend/ormconfig.js`:

```javascript
module.exports = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true',
  entities: ['src/entities/**/*.ts'],
  migrations: ['src/database/migrations/**/*.ts'],
  cli: {
    migrationsDir: 'src/database/migrations',
    entitiesDir: 'src/entities'
  },
  synchronize: false,  // Never use in production!
  logging: process.env.NODE_ENV === 'development'
};
```

---

## Migration Commands

### Available NPM Scripts

```bash
# Generate new migration from entity changes
npm run db:migration:generate -- --name="MigrationName"

# Create empty migration file
npm run db:migration:create -- --name="MigrationName"

# Run all pending migrations
npm run db:migrate

# Revert the last migration
npm run db:migrate:down

# Show migration status
npm run db:migration:show

# Reset database (drop all tables and rerun migrations)
npm run db:reset

# Seed database with test data
npm run db:seed
```

### Direct TypeORM Commands

```bash
cd src/backend

# Generate migration
npx typeorm migration:generate -n MigrationName

# Create empty migration
npx typeorm migration:create -n MigrationName

# Run migrations
npx typeorm migration:run

# Revert migration
npx typeorm migration:revert

# Show migration status
npx typeorm migration:show
```

---

## Creating Migrations

### 1. Entity-Based Migrations (Recommended)

When you modify entities, TypeORM can automatically generate migrations:

1. **Modify your entity**:
   ```typescript
   // src/backend/src/entities/User.ts
   @Entity('users')
   export class User {
     @PrimaryGeneratedColumn('uuid')
     id: string;

     @Column({ unique: true })
     email: string;

     // Add new column
     @Column({ nullable: true })
     firstName?: string;
   }
   ```

2. **Generate migration**:
   ```bash
   npm run db:migration:generate -- --name="AddFirstNameToUser"
   ```

3. **Review generated migration**:
   ```typescript
   // src/backend/src/database/migrations/1640995200000-AddFirstNameToUser.ts
   import { MigrationInterface, QueryRunner } from 'typeorm';

   export class AddFirstNameToUser1640995200000 implements MigrationInterface {
     name = 'AddFirstNameToUser1640995200000';

     public async up(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`ALTER TABLE "users" ADD "firstName" character varying`);
     }

     public async down(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
     }
   }
   ```

### 2. Custom Migrations

For complex changes, create custom migrations:

```bash
npm run db:migration:create -- --name="CreateIndexesAndTriggers"
```

Example custom migration:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIndexesAndTriggers1640995200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create indexes
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_users_email_verified" 
      ON "users" ("email", "isVerified") 
      WHERE "isVerified" = true
    `);

    // Create partial index
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_content_published" 
      ON "content" ("publishedAt") 
      WHERE "publishedAt" IS NOT NULL
    `);

    // Create trigger function
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updatedAt = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // Create trigger
    await queryRunner.query(`
      CREATE TRIGGER update_users_updated_at 
      BEFORE UPDATE ON users 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS update_users_updated_at ON users`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_updated_at_column()`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "idx_content_published"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "idx_users_email_verified"`);
  }
}
```

### 3. Data Migrations

For migrating existing data:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateUserProfiles1640995200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb
    `);

    // Migrate existing data
    await queryRunner.query(`
      UPDATE "users" 
      SET "profile" = jsonb_build_object(
        'firstName', "firstName",
        'lastName', "lastName",
        'bio', "bio"
      )
      WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL OR "bio" IS NOT NULL
    `);

    // Remove old columns
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bio"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add back old columns
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "firstName" varchar`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "lastName" varchar`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "bio" text`);

    // Migrate data back
    await queryRunner.query(`
      UPDATE "users" 
      SET 
        "firstName" = "profile"->>'firstName',
        "lastName" = "profile"->>'lastName',
        "bio" = "profile"->>'bio'
      WHERE "profile" IS NOT NULL
    `);

    // Remove new column
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profile"`);
  }
}
```

---

## Running Migrations

### Development Environment

```bash
# Run all pending migrations
npm run db:migrate

# Check migration status
npm run db:migration:show

# Rollback last migration (if needed)
npm run db:migrate:down
```

### Production Environment

**⚠️ Important**: Always backup your database before running migrations in production!

1. **Create database backup**:
   ```bash
   # For RDS
   aws rds create-db-snapshot \
     --db-instance-identifier your-db-instance \
     --db-snapshot-identifier before-migration-$(date +%Y%m%d-%H%M%S)
   ```

2. **Run migrations**:
   ```bash
   # Set production environment
   NODE_ENV=production npm run db:migrate
   ```

3. **Verify migration success**:
   ```bash
   npm run db:migration:show
   ```

### CI/CD Pipeline

Include migration step in your deployment pipeline:

```yaml
# .github/workflows/deploy.yml
- name: Run Database Migrations
  run: |
    npm run db:migrate
  env:
    NODE_ENV: production
    DB_HOST: ${{ secrets.DB_HOST }}
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

---

## Migration Best Practices

### 1. Migration Safety

**Always make migrations backward compatible when possible**:

```typescript
// ✅ Good: Add nullable column
await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "newField" varchar`);

// ❌ Bad: Add non-nullable column without default
await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "required" varchar NOT NULL`);

// ✅ Better: Add with default value
await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "required" varchar NOT NULL DEFAULT 'default-value'`);
```

### 2. Large Table Considerations

For large tables, use special techniques:

```typescript
// For adding indexes on large tables
await queryRunner.query(`CREATE INDEX CONCURRENTLY "idx_name" ON "table" ("column")`);

// For adding columns to large tables
await queryRunner.query(`ALTER TABLE "large_table" ADD COLUMN "new_col" varchar DEFAULT 'default'`);
// Then in a separate migration, make it NOT NULL if needed
```

### 3. Data Migration Patterns

```typescript
// Use transactions for data integrity
await queryRunner.startTransaction();
try {
  await queryRunner.query(`UPDATE table1 SET ...`);
  await queryRunner.query(`UPDATE table2 SET ...`);
  await queryRunner.commitTransaction();
} catch (error) {
  await queryRunner.rollbackTransaction();
  throw error;
}
```

### 4. Testing Migrations

Always test migrations:

```bash
# Test forward migration
npm run db:migrate

# Test rollback
npm run db:migrate:down

# Test forward again
npm run db:migrate
```

### 5. Naming Conventions

Use descriptive names:

```bash
# Good names
AddEmailIndexToUsers
CreateContentTable
MigrateUserProfileData
AddTimestampsToComments

# Bad names
Update1
Fix
NewTable
```

---

## Initial Database Schema

### Core Tables

The initial migration creates these core tables:

1. **Users Table**:
   ```sql
   CREATE TABLE "users" (
     "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "email" varchar UNIQUE NOT NULL,
     "password" varchar,
     "firstName" varchar,
     "lastName" varchar,
     "isVerified" boolean DEFAULT false,
     "role" varchar DEFAULT 'user',
     "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP
   );
   ```

2. **Content Table**:
   ```sql
   CREATE TABLE "content" (
     "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "title" varchar NOT NULL,
     "description" text,
     "type" varchar NOT NULL,
     "status" varchar DEFAULT 'draft',
     "authorId" uuid REFERENCES "users"("id"),
     "publishedAt" timestamp,
     "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP
   );
   ```

3. **Tags Table**:
   ```sql
   CREATE TABLE "tags" (
     "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "name" varchar UNIQUE NOT NULL,
     "description" text,
     "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP
   );
   ```

---

## Troubleshooting

### Common Migration Issues

#### 1. Migration Already Exists

**Error**: `Migration "MigrationName" already exists`

**Solution**:
```bash
# Remove the duplicate migration file
rm src/backend/src/database/migrations/duplicate-migration.ts

# Or rename it
mv src/backend/src/database/migrations/old.ts src/backend/src/database/migrations/new-name.ts
```

#### 2. Database Connection Issues

**Error**: `Connection refused` or `Authentication failed`

**Solutions**:
```bash
# Check database is running
docker-compose ps postgres

# Check connection parameters
echo $DB_HOST $DB_PORT $DB_USER $DB_NAME

# Test connection
docker-compose exec postgres psql -U contentuser -d contenthub
```

#### 3. Migration Lock Issues

**Error**: `Migration table is locked`

**Solutions**:
```bash
# Check for running migrations
docker-compose exec postgres psql -U contentuser -d contenthub -c "SELECT * FROM migrations"

# Clear lock (be careful!)
docker-compose exec postgres psql -U contentuser -d contenthub -c "UPDATE migrations SET timestamp = 0"
```

#### 4. Rollback Issues

**Error**: `Cannot rollback migration`

**Solutions**:
```bash
# Check migration status
npm run db:migration:show

# Fix migration manually in database
docker-compose exec postgres psql -U contentuser -d contenthub

# Remove from migration table
DELETE FROM migrations WHERE name = 'ProblematicMigration';
```

### Migration Validation

Create a validation script:

```bash
#!/bin/bash
# scripts/validate-migrations.sh

echo "Validating database migrations..."

# Reset database
npm run db:reset

# Run all migrations
npm run db:migrate

# Check migration status
npm run db:migration:show

# Run tests
npm run test:integration

echo "Migration validation complete!"
```

---

## Production Considerations

### 1. Zero-Downtime Migrations

For production systems requiring zero downtime:

1. **Phase 1**: Add new columns (nullable)
2. **Phase 2**: Deploy application code that writes to both old and new columns
3. **Phase 3**: Migrate existing data
4. **Phase 4**: Deploy application code that reads from new columns
5. **Phase 5**: Remove old columns

### 2. Migration Monitoring

Monitor migration performance:

```sql
-- Check long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity 
WHERE (now() - pg_stat_activity.query_start) > interval '1 minutes';

-- Check table locks
SELECT t.relname, l.locktype, page, virtualtransaction, pid, mode, granted
FROM pg_locks l, pg_stat_all_tables t
WHERE l.relation = t.relid
ORDER BY relation ASC;
```

### 3. Backup Strategy

Always backup before migrations:

```bash
# Automated backup script
#!/bin/bash
BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
docker-compose exec postgres pg_dump -U contentuser contenthub > "backups/${BACKUP_NAME}.sql"
echo "Backup created: ${BACKUP_NAME}.sql"
```

### 4. Rollback Plan

Always have a rollback plan:

1. **Database backup** (for data rollback)
2. **Application rollback** (previous version)
3. **Migration rollback** (down migrations)
4. **Testing plan** (verify rollback works)

---

## Migration Scripts

### First-Time Setup

This script is included in `scripts/first-time-setup.sh`:

```bash
#!/bin/bash
echo "Setting up database for first time..."

# Start database
docker-compose up -d postgres

# Wait for database to be ready
echo "Waiting for database to start..."
sleep 10

# Check if database is ready
docker-compose exec postgres pg_isready -U contentuser

# Run migrations
echo "Running database migrations..."
npm run db:migrate

# Seed data
echo "Seeding database with initial data..."
npm run db:seed

echo "Database setup complete!"
```

### Migration Health Check

```bash
#!/bin/bash
# scripts/migration-health-check.sh

echo "Checking migration health..."

# Check migration status
npm run db:migration:show

# Validate schema
docker-compose exec postgres psql -U contentuser -d contenthub -c "\d+"

# Check data integrity
npm run test:db:integrity

echo "Migration health check complete!"
```

---

This comprehensive guide should help you manage database migrations effectively throughout the development lifecycle of the AWS Community Content Hub.