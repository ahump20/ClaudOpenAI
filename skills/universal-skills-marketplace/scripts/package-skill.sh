#!/bin/bash
# package-skill.sh — wraps skill-creator's package_skill.py to emit a .skill bundle
# Usage: package-skill.sh <skill-name> [--out <output-dir>]
#
# Produces: <output-dir>/<skill-name>.skill (zip archive)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SKILL_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
REPO_ROOT="$( cd "${SKILL_DIR}/../.." && pwd )"

# Find skill-creator's package_skill.py
SKILL_CREATOR_SCRIPT=""
for candidate in \
  "$HOME/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/scripts/package_skill.py" \
  "$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator/scripts/package_skill.py"
do
  if [ -f "$candidate" ]; then
    SKILL_CREATOR_SCRIPT="$candidate"
    break
  fi
done

SKILL_NAME="${1:-universal-skills-marketplace}"
OUT_DIR="${2:-$REPO_ROOT/../../skill-packages}"

INPUT_DIR="$REPO_ROOT/skills/$SKILL_NAME"
if [ ! -d "$INPUT_DIR" ]; then
  echo "ERROR: skill directory not found: $INPUT_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "=== Validating skill before packaging ==="
bash "$INPUT_DIR/scripts/validate.sh" || { echo "validation failed; aborting" >&2; exit 1; }

echo ""
echo "=== Packaging $SKILL_NAME ==="

if [ -n "$SKILL_CREATOR_SCRIPT" ] && command -v python3 >/dev/null 2>&1; then
  echo "Using skill-creator: $SKILL_CREATOR_SCRIPT"
  python3 "$SKILL_CREATOR_SCRIPT" "$INPUT_DIR" "$OUT_DIR" 2>&1 || {
    echo "skill-creator failed; falling back to zip" >&2
    fallback_zip "$INPUT_DIR" "$OUT_DIR/$SKILL_NAME.skill"
  }
else
  echo "skill-creator not found; using zip fallback"
  fallback_zip "$INPUT_DIR" "$OUT_DIR/$SKILL_NAME.skill"
fi

fallback_zip() {
  local src="$1"
  local out="$2"
  (cd "$(dirname "$src")" && zip -r -q "$out" "$(basename "$src")")
  echo "  ✓ Created $out ($(du -h "$out" | cut -f1))"
}

# Re-check if the skill-creator approach produced the file
PRODUCED="$OUT_DIR/$SKILL_NAME.skill"
if [ -f "$PRODUCED" ]; then
  echo ""
  echo "✓ Packaged: $PRODUCED ($(du -h "$PRODUCED" | cut -f1))"
else
  echo "✗ Package not produced; check logs above" >&2
  exit 1
fi
