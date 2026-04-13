#!/bin/bash
# validate.sh — ClaudOpenAI universal-skills-marketplace skill self-validator
# Checks the skill structure against the BSI router pattern + agentskills.io spec.
# Exit 0 = valid. Exit 1 = one or more rules failed.
#
# Rules:
#   R1. SKILL.md exists and is non-empty
#   R2. SKILL.md is <= 100 lines (router pattern)
#   R3. SKILL.md has YAML frontmatter with name + description
#   R4. SKILL.md frontmatter `name` matches directory name
#   R5. references/, scripts/, assets/ directories exist
#   R6. References numbered 00-12 all present (this skill specifies 13 ref files)
#   R7. Every script file is executable
#   R8. No broken relative markdown links within the skill
#   R9. Assets subdirs present: schemas, templates, real-examples, fixtures, diagrams

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SKILL_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
SKILL_NAME="$(basename "$SKILL_DIR")"
SKILL_MD="$SKILL_DIR/SKILL.md"

FAIL_COUNT=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

echo "=== Validating skill: $SKILL_NAME ==="
echo "    path: $SKILL_DIR"
echo ""

# R1
echo "R1. SKILL.md exists and non-empty"
if [ -f "$SKILL_MD" ] && [ -s "$SKILL_MD" ]; then
  pass "SKILL.md exists ($(wc -c < "$SKILL_MD") bytes)"
else
  fail "SKILL.md missing or empty"
fi

# R2
echo ""
echo "R2. SKILL.md ≤ 100 lines (router pattern)"
LINES=$(wc -l < "$SKILL_MD" | tr -d ' ')
if [ "$LINES" -le 100 ]; then
  pass "SKILL.md is $LINES lines (≤ 100)"
else
  fail "SKILL.md is $LINES lines (> 100) — extract workflows into references/"
fi

# R3
echo ""
echo "R3. YAML frontmatter with required keys"
FRONTMATTER=$(awk '/^---$/{flag=!flag; next} flag' "$SKILL_MD")
if [ -n "$FRONTMATTER" ]; then
  if echo "$FRONTMATTER" | grep -q "^name:"; then pass "frontmatter has 'name'"; else fail "frontmatter missing 'name'"; fi
  if echo "$FRONTMATTER" | grep -q "^description:"; then pass "frontmatter has 'description'"; else fail "frontmatter missing 'description'"; fi
else
  fail "no YAML frontmatter block detected (expected --- ... --- at top)"
fi

# R4
echo ""
echo "R4. frontmatter name matches directory name"
FM_NAME=$(echo "$FRONTMATTER" | grep "^name:" | sed 's/^name: *//' | tr -d ' ')
if [ "$FM_NAME" = "$SKILL_NAME" ]; then
  pass "name '$FM_NAME' matches dir '$SKILL_NAME'"
else
  fail "name '$FM_NAME' does not match dir '$SKILL_NAME'"
fi

# R5
echo ""
echo "R5. required subdirectories present"
for d in references scripts assets; do
  if [ -d "$SKILL_DIR/$d" ]; then
    pass "$d/ exists"
  else
    fail "$d/ missing"
  fi
done

# R6
echo ""
echo "R6. references 00-12 all present"
MISSING_REFS=""
for n in 00 01 02 03 04 05 06 07 08 09 10 11 12; do
  if ls "$SKILL_DIR/references/${n}-"*.md >/dev/null 2>&1; then
    : # found
  else
    MISSING_REFS="$MISSING_REFS $n"
  fi
done
if [ -z "$MISSING_REFS" ]; then
  pass "all 13 references (00-12) present"
else
  fail "missing references:$MISSING_REFS"
fi

# R7
echo ""
echo "R7. scripts executable"
NON_EXEC=""
for script in "$SKILL_DIR/scripts/"*.sh; do
  [ -e "$script" ] || continue
  if [ ! -x "$script" ]; then
    NON_EXEC="$NON_EXEC $(basename "$script")"
  fi
done
if [ -z "$NON_EXEC" ]; then
  pass "all .sh scripts executable"
else
  fail "not executable (run chmod +x):$NON_EXEC"
fi

# R8: broken links check (simplified — look for .md links that don't exist)
echo ""
echo "R8. no broken intra-skill markdown links"
BROKEN=0
for mdfile in "$SKILL_MD" "$SKILL_DIR/references/"*.md "$SKILL_DIR/assets/"*/README.md; do
  [ -f "$mdfile" ] || continue
  # Extract links of form [text](relative.md) or [text](./something.md) or [text](references/x.md)
  LINKS=$(grep -oE '\]\(([^)]+\.md)\)' "$mdfile" | sed 's/^](//;s/)$//' | sort -u)
  for link in $LINKS; do
    # Skip http/https links and other absolute schemes
    [[ "$link" =~ ^https?:// ]] && continue
    [[ "$link" =~ ^file:// ]] && continue
    # Strip anchor fragments
    target="${link%%#*}"
    [ -z "$target" ] && continue
    # Resolve relative to the markdown file's dir
    mdfile_dir=$(dirname "$mdfile")
    resolved="$mdfile_dir/$target"
    # Special case: links to /docs/spikes/ or similar outside the skill
    case "$target" in
      ../../../*|docs/*|../../*) continue ;;
    esac
    if [ ! -e "$resolved" ]; then
      BROKEN=$((BROKEN + 1))
      echo "      broken: $mdfile -> $target"
    fi
  done
done
if [ "$BROKEN" -eq 0 ]; then
  pass "no broken intra-skill links"
else
  fail "$BROKEN broken link(s) found"
fi

# R9
echo ""
echo "R9. assets subdirs present"
for d in schemas templates real-examples fixtures diagrams; do
  if [ -d "$SKILL_DIR/assets/$d" ]; then
    pass "assets/$d/ exists"
  else
    fail "assets/$d/ missing"
  fi
done

# Summary
echo ""
echo "=== Summary ==="
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "✓ PASS — $SKILL_NAME is valid"
  exit 0
else
  echo "✗ FAIL — $FAIL_COUNT rule(s) failed"
  exit 1
fi
