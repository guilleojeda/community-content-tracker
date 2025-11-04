#!/bin/bash
# Setup integration test database for PostgreSQL
# This script creates the integration_test_db database and integration_test_user role
# Required for running integration tests in tests/integration/database-real.test.ts

set -e

# Configuration
DB_NAME="integration_test_db"
DB_USER="integration_test_user"
DB_PASSWORD="integration_test_password"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

echo "Setting up integration test database..."

# Check if PostgreSQL is running
if ! pg_isready -h localhost > /dev/null 2>&1; then
    echo "FAIL Error: PostgreSQL is not running on localhost"
    echo "Please start PostgreSQL first:"
    echo "  - Docker: docker-compose up -d"
    echo "  - macOS: brew services start postgresql@15"
    exit 1
fi

# Drop existing database and user if they exist (for clean setup)
echo "Cleaning up existing test database and user..."
psql -U "$POSTGRES_USER" -h localhost -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
psql -U "$POSTGRES_USER" -h localhost -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true

# Create test user
echo "Creating test user: $DB_USER"
psql -U "$POSTGRES_USER" -h localhost <<EOF
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
ALTER USER $DB_USER CREATEDB;
EOF

# Create test database
echo "Creating test database: $DB_NAME"
psql -U "$POSTGRES_USER" -h localhost <<EOF
CREATE DATABASE $DB_NAME OWNER $DB_USER;
EOF

# Grant privileges
echo "Granting privileges..."
psql -U "$POSTGRES_USER" -h localhost -d "$DB_NAME" <<EOF
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF

# Install pgvector extension
echo "Installing pgvector extension..."
psql -U "$POSTGRES_USER" -h localhost -d "$DB_NAME" <<EOF
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOF

echo "Integration test database setup complete!"
echo ""
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Connection string: postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo ""
echo "To run integration tests:"
echo "  export DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo "  npm run test --workspace=src/backend"
