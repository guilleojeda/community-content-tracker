#!/bin/bash
# Setup integration test database
set -e

DB_NAME="integration_test_db"
DB_USER="integration_test_user"
DB_PASSWORD="integration_test_password"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

echo "Setting up integration test database..."

if ! pg_isready -h localhost > /dev/null 2>&1; then
    echo "❌ Error: PostgreSQL is not running"
    exit 1
fi

echo "Cleaning up existing test database..."
psql -U "$POSTGRES_USER" -h localhost -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
psql -U "$POSTGRES_USER" -h localhost -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true

echo "Creating test user: $DB_USER"
psql -U "$POSTGRES_USER" -h localhost <<EOF
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
ALTER USER $DB_USER CREATEDB;
EOF

echo "Creating test database: $DB_NAME"
psql -U "$POSTGRES_USER" -h localhost <<EOF
CREATE DATABASE $DB_NAME OWNER $DB_USER;
EOF

echo "Granting privileges..."
psql -U "$POSTGRES_USER" -h localhost -d "$DB_NAME" <<EOF
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF

echo "Installing pgvector extension..."
psql -U "$POSTGRES_USER" -h localhost -d "$DB_NAME" <<EOF
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOF

echo "✅ Integration test database setup complete!"
echo ""
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Connection: postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
