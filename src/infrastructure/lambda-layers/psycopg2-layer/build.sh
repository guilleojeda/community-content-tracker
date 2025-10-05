#!/bin/bash

# Build script for psycopg2 Lambda Layer
# This creates a Lambda layer with psycopg2-binary for Python 3.11

echo "Building psycopg2 Lambda Layer..."

# Clean previous build
rm -rf python/

# Create python directory for Lambda layer structure
mkdir -p python/

# Install psycopg2-binary for Lambda Python 3.11 runtime
pip install -r requirements.txt -t python/ --platform manylinux2014_x86_64 --only-binary :all: --python-version 3.11

# Remove unnecessary files to reduce layer size
find python -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find python -type f -name "*.pyc" -delete
find python -type f -name "*.pyo" -delete
find python -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null
find python -type d -name "tests" -exec rm -rf {} + 2>/dev/null

echo "Lambda Layer build complete!"