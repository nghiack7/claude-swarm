#!/bin/bash
# Claude Swarm Demo Recording Script
# Run: bash demo/record-demo.sh
# Output: demo/demo.cast (asciinema recording)

set -e
cd "$(dirname "$0")/.."

echo "🎬 Recording Claude Swarm demo..."
echo ""

# Scene 1: Show adapters
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Scene 1: Available CLI Adapters"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "$ npx tsx src/cli.ts adapters"
npx tsx src/cli.ts adapters
sleep 2

# Scene 2: Show help
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Scene 2: CLI Commands"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "$ npx tsx src/cli.ts help"
npx tsx src/cli.ts help
sleep 2

# Scene 3: Run a real swarm
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Scene 3: Multi-CLI Pipeline (Claude + Codex)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo '$ npx tsx src/cli.ts run "Write a TypeScript function to validate URLs" \'
echo '    --agent "planner:claude:claude-haiku-4-5-20251001" \'
echo '    --agent "coder:codex:o4-mini" \'
echo '    --agent "reviewer:claude:claude-haiku-4-5-20251001" \'
echo '    --no-tui'
echo ""

npx tsx src/cli.ts run "Write a TypeScript function to validate URLs" \
  --agent "planner:claude:claude-haiku-4-5-20251001" \
  --agent "coder:codex:o4-mini" \
  --agent "reviewer:claude:claude-haiku-4-5-20251001" \
  --no-tui

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Demo complete!"
echo "  ⭐ Star: github.com/nghiack7/claude-swarm"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
