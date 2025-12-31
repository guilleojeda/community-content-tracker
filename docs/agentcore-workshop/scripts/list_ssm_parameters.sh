#!/bin/bash

set -e
set -o pipefail

NAMESPACE="/app/customersupport"
REGION=$(aws configure get region)

echo "[LEFT-POINTING MAGNIFYING GLASS] Listing SSM parameters under namespace: $NAMESPACE/*"
echo "[ROUND PUSHPIN] Region: $REGION"
echo ""

# Fetch and paginate through all parameters under the given path
aws ssm get-parameters-by-path \
  --path "$NAMESPACE" \
  --recursive \
  --with-decryption \
  --region "$REGION" \
  --query "Parameters[*].{Name:Name,Value:Value}" \
  --output table
