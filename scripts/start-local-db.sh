#!/bin/bash

echo "Starting local PostgreSQL with pgvector..."

# Stop existing container if running
docker stop postgres-pgvector 2>/dev/null
docker rm postgres-pgvector 2>/dev/null

# Start new container
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=localpassword \
  -e POSTGRES_DB=content_hub_dev \
  -e POSTGRES_USER=postgres \
  -p 5432:5432 \
  ankane/pgvector:latest

echo "Waiting for PostgreSQL to be ready..."
sleep 5

echo "Enabling pgvector extension..."
docker exec postgres-pgvector psql -U postgres -d content_hub_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "Local database ready at postgresql://postgres:localpassword@localhost:5432/content_hub_dev"
