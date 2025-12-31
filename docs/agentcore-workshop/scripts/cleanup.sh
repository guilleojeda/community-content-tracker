#!/bin/bash

set -e
set -o pipefail

# ----- Config -----
BUCKET_NAME=${1:-customersupport}
INFRA_STACK_NAME=${2:-CustomerSupportStackInfra}
COGNITO_STACK_NAME=${3:-CustomerSupportStackCognito}
REGION=$(aws configure get region)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
FULL_BUCKET_NAME="${BUCKET_NAME}-${ACCOUNT_ID}"
ZIP_FILE="lambda.zip"
S3_KEY="lambda.zip"
if [ $? -ne 0 ] || [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "None" ]; then
    echo "[CROSS MARK] Failed to get AWS Account ID. Please check your AWS credentials and network connectivity."
    echo "Error: $ACCOUNT_ID"
    exit 1
fi

# ----- Confirm Deletion -----
read -p "[WARNING SIGN] Are you sure you want to delete stacks '$INFRA_STACK_NAME', '$COGNITO_STACK_NAME' and clean up S3? (y/N): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "[CROSS MARK] Cleanup cancelled."
  exit 1
fi

# ----- 1. Delete CloudFormation stacks -----
echo "[FIRECRACKER] Deleting stack: $INFRA_STACK_NAME..."
aws cloudformation delete-stack --stack-name "$INFRA_STACK_NAME" --region "$REGION"
echo "Waiting for $INFRA_STACK_NAME to be deleted..."
aws cloudformation wait stack-delete-complete --stack-name "$INFRA_STACK_NAME" --region "$REGION"
echo "[WHITE HEAVY CHECK MARK] Stack $INFRA_STACK_NAME deleted."

echo "[FIRECRACKER] Deleting stack: $COGNITO_STACK_NAME..."
aws cloudformation delete-stack --stack-name "$COGNITO_STACK_NAME" --region "$REGION"
echo "Waiting for $COGNITO_STACK_NAME to be deleted..."
aws cloudformation wait stack-delete-complete --stack-name "$COGNITO_STACK_NAME" --region "$REGION"
echo "[WHITE HEAVY CHECK MARK] Stack $COGNITO_STACK_NAME deleted."

# ----- 2. Delete zip file from S3 -----
echo "[BROOM] Deleting all contents of s3://$FULL_BUCKET_NAME..."
aws s3 rm "s3://$FULL_BUCKET_NAME" --recursive || echo "[WARNING SIGN] Failed to clean bucket or it is already empty."

# ----- 3. Optionally delete the bucket -----
read -p "[BUCKET] Do you want to delete the bucket '$FULL_BUCKET_NAME'? (y/N): " delete_bucket
if [[ "$delete_bucket" == "y" || "$delete_bucket" == "Y" ]]; then
  echo "[PUT LITTER IN ITS PLACE SYMBOL] Deleting bucket $FULL_BUCKET_NAME..."
  aws s3 rb "s3://$FULL_BUCKET_NAME" --force
  echo "[WHITE HEAVY CHECK MARK] Bucket deleted."
else
  echo "[BUCKET] Bucket retained: $FULL_BUCKET_NAME"
fi

# ----- 4. Clean up local zip file -----
echo "[WASTEBASKET] Removing local file $ZIP_FILE..."
rm -f "$ZIP_FILE"

# ----- 5. Delete Knowledge Base -----

echo "[WASTEBASKET] Deleting Knowledgebase"
python prerequisite/knowledge_base.py --mode delete

echo "[WHITE HEAVY CHECK MARK] Deployment complete."
