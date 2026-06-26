#!/bin/bash
# Apply the Z.ai Coding Plan fix to your local repo
# Usage: bash apply-fix.sh /path/to/your/repo

set -e

REPO_DIR="${1:-.}"
FIX_DIR="$(cd "$(dirname "$0")" && pwd)/zai-fix"

if [ ! -d "$REPO_DIR/lib" ]; then
  echo "Error: $REPO_DIR does not look like the hope-tender-path-b repo"
  echo "Usage: bash apply-fix.sh /path/to/your/repo"
  exit 1
fi

echo "Applying Z.ai Coding Plan fix to $REPO_DIR..."

# File 1: Update the registry allowlist
cp "$FIX_DIR/ai-provider-registry.ts" "$REPO_DIR/lib/ai-provider-registry.ts"
echo "  ✓ Updated lib/ai-provider-registry.ts (allowlist now includes glm-4-coding)"

# File 2: Create the diagnostic endpoint
mkdir -p "$REPO_DIR/app/api/admin/ai-provider-health/zai-diagnostic"
cp "$FIX_DIR/zai-diagnostic-route.ts" "$REPO_DIR/app/api/admin/ai-provider-health/zai-diagnostic/route.ts"
echo "  ✓ Created app/api/admin/ai-provider-health/zai-diagnostic/route.ts"

# File 3: Update the regression test
cp "$FIX_DIR/zai-model-regression.test.ts" "$REPO_DIR/tests/zai-model-regression.test.ts"
echo "  ✓ Updated tests/zai-model-regression.test.ts"

echo ""
echo "Done! Next steps:"
echo "  cd $REPO_DIR"
echo "  git add lib/ai-provider-registry.ts app/api/admin/ai-provider-health/zai-diagnostic/route.ts tests/zai-model-regression.test.ts"
echo "  git commit -m 'fix(zai): add Coding Plan models to allowlist + diagnostic endpoint'"
echo "  git push origin main"
echo ""
echo "Then set in Vercel env vars:"
echo "  ZAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4"
echo "  ZAI_PROPOSAL_MODEL=glm-4-coding"
echo "  ZAI_ANALYSIS_MODEL=glm-4-coding"
echo "  ZAI_FAST_MODEL=glm-4-coding"
echo ""
echo "Or alternatively, just DELETE ZAI_API_KEY from Vercel to skip Z.ai entirely."
