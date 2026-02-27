#!/bin/bash
set -euo pipefail

# =====================================================
# Lazarus — Initial Setup Script
# =====================================================
# Run this once to set up the AWS environment for Lazarus.
# Prerequisites: AWS CLI configured, Node.js 20+, Docker
# =====================================================

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PROJECT_NAME="lazarus"

echo "============================================"
echo "  Lazarus — Initial Setup"
echo "  Region: $REGION"
echo "  Account: $ACCOUNT_ID"
echo "============================================"

# 1. Create ECR repositories
echo ""
echo ">>> Creating ECR repositories..."

for REPO in "${PROJECT_NAME}-github-mcp" "${PROJECT_NAME}-websearch-mcp" "${PROJECT_NAME}-sandbox"; do
  if aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" 2>/dev/null; then
    echo "  ✓ $REPO already exists"
  else
    aws ecr create-repository \
      --repository-name "$REPO" \
      --region "$REGION" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256
    echo "  ✓ Created $REPO"
  fi
done

# 2. Create Secrets Manager secrets (empty - user will fill in)
echo ""
echo ">>> Creating Secrets Manager secrets..."

for SECRET in "${PROJECT_NAME}/github-pat" "${PROJECT_NAME}/tavily-api-key"; do
  if aws secretsmanager describe-secret --secret-id "$SECRET" --region "$REGION" 2>/dev/null; then
    echo "  ✓ $SECRET already exists"
  else
    aws secretsmanager create-secret \
      --name "$SECRET" \
      --region "$REGION" \
      --description "Lazarus secret: $SECRET" \
      --secret-string "REPLACE_ME"
    echo "  ✓ Created $SECRET (update with real value)"
  fi
done

# 3. Enable Bedrock model access
echo ""
echo ">>> Bedrock Model Access"
echo "  ⚠️  You must manually enable model access in the AWS Console:"
echo "  1. Go to: https://${REGION}.console.aws.amazon.com/bedrock/home?region=${REGION}#/modelaccess"
echo "  2. Click 'Manage model access'"
echo "  3. Enable these models:"
echo "     - Anthropic Claude 3.5 Sonnet v2"
echo "     - Anthropic Claude 3 Haiku"
echo "  4. Submit and wait for access to be granted"
echo ""

# 4. Build and push Docker images
echo ""
echo ">>> Building Docker images..."

# Login to ECR
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# GitHub MCP
echo "  Building github-mcp..."
docker build -t "${PROJECT_NAME}-github-mcp" -f docker/Dockerfile.github-mcp .
docker tag "${PROJECT_NAME}-github-mcp:latest" "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT_NAME}-github-mcp:latest"
docker push "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT_NAME}-github-mcp:latest"
echo "  ✓ Pushed github-mcp"

# WebSearch MCP
echo "  Building websearch-mcp..."
docker build -t "${PROJECT_NAME}-websearch-mcp" -f docker/Dockerfile.websearch-mcp .
docker tag "${PROJECT_NAME}-websearch-mcp:latest" "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT_NAME}-websearch-mcp:latest"
docker push "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT_NAME}-websearch-mcp:latest"
echo "  ✓ Pushed websearch-mcp"

# Sandbox
echo "  Building sandbox..."
docker build -t "${PROJECT_NAME}-sandbox" -f docker/Dockerfile.sandbox .
docker tag "${PROJECT_NAME}-sandbox:latest" "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT_NAME}-sandbox:latest"
docker push "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT_NAME}-sandbox:latest"
echo "  ✓ Pushed sandbox"

# 5. Install dependencies
echo ""
echo ">>> Installing dependencies..."
npm install

echo ""
echo ">>> Building backend..."
cd backend && npm run build && cd ..

echo ""
echo ">>> Building infrastructure..."
cd infrastructure && npm run build && cd ..

echo ""
echo "============================================"
echo "  ✅ Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Enable Bedrock model access (see above)"
echo "  2. Update secrets with real values:"
echo "     aws secretsmanager update-secret --secret-id ${PROJECT_NAME}/tavily-api-key --secret-string 'YOUR_KEY'"
echo "  3. Deploy the stack:"
echo "     ./scripts/deploy.sh"
echo "============================================"
