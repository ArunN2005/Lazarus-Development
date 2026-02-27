#!/bin/bash
set -euo pipefail

# =====================================================
# Lazarus — Upload Config to S3
# =====================================================

REGION="${AWS_REGION:-ap-south-1}"
CONFIG_BUCKET="${CONFIG_BUCKET:-lazarus-config-$(aws sts get-caller-identity --query Account --output text)}"

echo "============================================"
echo "  Lazarus — Seed Config"
echo "  Bucket: $CONFIG_BUCKET"
echo "============================================"

# Upload overlay script
echo ">>> Uploading overlay script..."
aws s3 cp backend/overlay/lazarus-overlay.ts \
  "s3://${CONFIG_BUCKET}/overlay/lazarus-overlay.js" \
  --content-type "application/javascript" \
  --region "$REGION"
echo "  ✓ Overlay script uploaded"

echo ""
echo "  ✅ Config seeded!"
echo "============================================"
