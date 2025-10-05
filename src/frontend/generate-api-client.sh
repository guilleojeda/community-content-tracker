#!/bin/bash

# API Client Generation Script for Sprint 5
# Generates TypeScript API client from OpenAPI specification
# Uses openapi-typescript (pure Node.js, no Java required)

set -e

echo "Generating API client from OpenAPI specification..."

# Check if OpenAPI spec exists
if [ ! -f "../backend/openapi.yaml" ]; then
  echo "Error: OpenAPI specification not found at ../backend/openapi.yaml"
  exit 1
fi

# Create output directory
mkdir -p ./src/lib/api-client

# Generate TypeScript types from OpenAPI spec
npx openapi-typescript ../backend/openapi.yaml -o ./src/lib/api-client/schema.ts

# Create client wrapper using openapi-fetch
cat > ./src/lib/api-client/index.ts << 'EOF'
import createClient from 'openapi-fetch';
import type { paths } from './schema';

// Create typed API client
export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Export types for use in components
export type { paths, components } from './schema';
EOF

echo "API client generated successfully at ./src/lib/api-client"
echo "You can now import and use the client in your components"
