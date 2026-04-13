#!/bin/bash
# fetch-upstream-catalog.sh — clone all 9 verified upstream repos to /tmp for dev indexer testing
# Usage: fetch-upstream-catalog.sh [--refresh-real-examples]
#
# Output: /tmp/claudopenai-upstreams/<org>-<repo>/ (shallow clones)
# If --refresh-real-examples: also refreshes assets/real-examples/ from installed plugins.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SKILL_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
CACHE_DIR="/tmp/claudopenai-upstreams"

mkdir -p "$CACHE_DIR"

# 9 verified upstream repos per docs/spikes/upstream-availability.md
REPOS=(
  "anthropics/claude-plugins-official"
  "anthropics/skills"
  "anthropics/knowledge-work-plugins"
  "openai/codex"
  "openai/codex-plugin-cc"
  "openai/skills"
  "openai/swarm"
  "openai/openai-agents-python"
  "openai/plugins"
)

for repo in "${REPOS[@]}"; do
  slug=$(echo "$repo" | tr '/' '-')
  target="$CACHE_DIR/$slug"

  if [ -d "$target" ]; then
    echo "Updating $repo..."
    (cd "$target" && git fetch origin --depth=1 && git reset --hard origin/HEAD) 2>&1 | head -5
  else
    echo "Cloning $repo..."
    git clone --depth=1 --filter=blob:none --sparse "https://github.com/$repo.git" "$target" 2>&1 | head -5
    (cd "$target" && git sparse-checkout set skills plugins .codex-plugin .claude-plugin SKILL.md) 2>&1 | head -3 || true
  fi

  # Count relevant files
  skill_count=$(find "$target" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
  plugin_count=$(find "$target" -path "*/.claude-plugin/plugin.json" -o -path "*/.codex-plugin/plugin.json" 2>/dev/null | wc -l | tr -d ' ')
  echo "  SKILL.md: $skill_count, plugin.json: $plugin_count"
done

echo ""
echo "Cached $CACHE_DIR — $(du -sh $CACHE_DIR | cut -f1) total"

if [[ "${1:-}" == "--refresh-real-examples" ]]; then
  echo ""
  echo "Refreshing assets/real-examples/..."
  RE_DIR="$SKILL_DIR/assets/real-examples"
  cp ~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.claude-plugin/plugin.json "$RE_DIR/context7-plugin.json" 2>&1 || true
  cp ~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.mcp.json "$RE_DIR/context7-mcp.json" 2>&1 || true
  CODEX_PLUGINS_PARENT="$HOME/.codex/plugins/cache/openai-curated"
  for p in canva cloudflare github figma; do
    src=$(ls "$CODEX_PLUGINS_PARENT/$p"/*/.codex-plugin/plugin.json 2>/dev/null | head -1)
    if [ -n "$src" ]; then
      cp "$src" "$RE_DIR/openai-$p-plugin.json"
    fi
  done
  echo "  ✓ Real examples refreshed"
fi
