#!/bin/bash
# scaffold.sh — generate a new plugin/skill project from ClaudOpenAI templates
# Usage: scaffold.sh --name <kebab-case> --target <claude|codex|both> [--out <dir>]
#
# Produces a ready-to-commit plugin directory with:
#   - plugin manifest(s)
#   - .mcp.json
#   - skills/<name>/ skeleton (SKILL.md + references + scripts + assets)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEMPLATE_DIR="$SCRIPT_DIR/../assets/templates"

NAME=""
TARGET="both"
OUT_DIR=""
DESCRIPTION="A new skill"
AUTHOR_NAME="${USER}"
AUTHOR_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    --author) AUTHOR_NAME="$2"; shift 2 ;;
    --email) AUTHOR_EMAIL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --name <kebab> --target <claude|codex|both> [--out <dir>] [--description <str>] [--author <name>] [--email <addr>]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$NAME" ]; then
  echo "ERROR: --name is required" >&2
  exit 1
fi

if [[ ! "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERROR: --name must be kebab-case (got: $NAME)" >&2
  exit 1
fi

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="./$NAME"
fi

if [ -e "$OUT_DIR" ]; then
  echo "ERROR: $OUT_DIR already exists" >&2
  exit 1
fi

echo "Scaffolding '$NAME' at $OUT_DIR (target: $TARGET)..."

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

# Mustache-style substitution
substitute() {
  local tmpl="$1"
  sed \
    -e "s/{{plugin_name_kebab}}/$NAME/g" \
    -e "s/{{skill_name_kebab}}/$NAME/g" \
    -e "s/{{skill_title_case}}/$(echo $NAME | sed 's/-/ /g; s/\b\w/\u&/g')/g" \
    -e "s/{{one_sentence_description}}/$DESCRIPTION/g" \
    -e "s/{{description_with_triggers}}/$DESCRIPTION Triggers on \"$NAME\"./g" \
    -e "s/{{version_semver}}/0.1.0/g" \
    -e "s/{{author_name}}/$AUTHOR_NAME/g" \
    -e "s/{{author_email}}/$AUTHOR_EMAIL/g" \
    -e "s|{{author_url}}|https://example.com|g" \
    -e "s|{{homepage_url}}|https://example.com|g" \
    -e "s|{{repository_url}}|https://github.com/$AUTHOR_NAME/$NAME|g" \
    -e "s/{{license_spdx}}/Apache-2.0/g" \
    -e "s/{{display_name_title_case}}/$(echo $NAME | sed 's/-/ /g; s/\b\w/\u&/g')/g" \
    -e "s/{{short_description_max_60}}/$DESCRIPTION/g" \
    -e "s/{{long_description_paragraph}}/$DESCRIPTION/g" \
    -e "s/{{developer_name}}/$AUTHOR_NAME/g" \
    -e "s|{{website_url}}|https://example.com|g" \
    -e "s|{{privacy_url}}|https://example.com/privacy|g" \
    -e "s|{{terms_url}}|https://example.com/terms|g" \
    -e "s/{{brand_color_hex}}/#BF5700/g" \
    -e "s|{{server_name}}|$NAME|g" \
    -e "s|{{npm_package_name}}|@$AUTHOR_NAME/$NAME-mcp|g" \
    "$tmpl"
}

if [[ "$TARGET" == "claude" || "$TARGET" == "both" ]]; then
  mkdir -p .claude-plugin
  substitute "$TEMPLATE_DIR/claude-plugin.json.template" > .claude-plugin/plugin.json
  substitute "$TEMPLATE_DIR/mcp-json-claude-flat.template" > .mcp.json
  echo "  ✓ Claude plugin manifest created"
fi

if [[ "$TARGET" == "codex" || "$TARGET" == "both" ]]; then
  mkdir -p .codex-plugin
  substitute "$TEMPLATE_DIR/codex-plugin.json.template" > .codex-plugin/plugin.json
  substitute "$TEMPLATE_DIR/mcp-json-codex-wrapped.template" > .codex-plugin/.mcp.json
  echo "  ✓ Codex plugin manifest created"
fi

# Skills directory with router + minimal references
mkdir -p "skills/$NAME/references" "skills/$NAME/scripts" "skills/$NAME/assets"
substitute "$TEMPLATE_DIR/standalone-SKILL.md.template" > "skills/$NAME/SKILL.md"

# Minimal validate.sh in the new skill (copy from this skill's scripts/)
cp "$SCRIPT_DIR/validate.sh" "skills/$NAME/scripts/validate.sh"
chmod +x "skills/$NAME/scripts/validate.sh"
echo "  ✓ skills/$NAME/ skeleton created"

echo ""
echo "Next steps:"
echo "  cd $OUT_DIR"
echo "  # Edit .claude-plugin/plugin.json and .codex-plugin/plugin.json to taste"
echo "  # Flesh out skills/$NAME/SKILL.md and add references/*.md"
echo "  bash skills/$NAME/scripts/validate.sh"
