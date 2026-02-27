#!/bin/bash
set -euo pipefail

# =====================================================
# Lazarus — CDK Deploy Script
# =====================================================

REGION="${AWS_REGION:-ap-south-1}"
STACK_NAME="LazarusStack"

echo "============================================"
echo "  Lazarus — Deploying to $REGION"
echo "============================================"

# Build backend
echo ">>> Building backend..."
cd backend && npm run build && cd ..

# Build infrastructure
echo ">>> Building infrastructure..."
cd infrastructure && npm run build

# Bootstrap CDK (first time only)
echo ">>> Bootstrapping CDK..."
npx cdk bootstrap --region "$REGION" 2>/dev/null || true

# Synth first to validate
echo ">>> Synthesizing CloudFormation..."
npx cdk synth

# Show diff
echo ">>> Changes:"
npx cdk diff || true

# Deploy
echo ""
echo ">>> Deploying $STACK_NAME..."
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  --outputs-file ../cdk-outputs.json

cd ..

echo ""
echo "============================================"
echo "  ✅ Deployment complete!"
echo ""

# Parse outputs
if [ -f cdk-outputs.json ]; then
  echo "  Outputs:"
  cat cdk-outputs.json | python3 -m json.tool 2>/dev/null || cat cdk-outputs.json
  echo ""
  echo "  Set these in your frontend .env.local:"
  echo "  NEXT_PUBLIC_API_URL=<ApiUrl from outputs>"
  echo "  NEXT_PUBLIC_WS_URL=<WebSocketUrl from outputs>"
fi

echo "============================================"
