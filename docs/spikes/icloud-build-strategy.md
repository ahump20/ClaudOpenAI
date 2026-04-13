# Spike S7 — iCloud Build Strategy

**Context:** The repo lives at `/Users/AustinHumphrey/Library/Mobile Documents/com~apple~CloudDocs/BSI-repo/external/ClaudOpenAI/` per Austin's choice. iCloud's FileProvider is known to stall on `npm install`, `git` index ops, and `wrangler` deploys when many small files change.

## Problem statement

- `node_modules/` can contain 50,000+ files across 5,000+ directories. iCloud tries to sync each one, creating FileProvider backpressure.
- Git index lock contention: concurrent iCloud sync + git ops races create `.git/index.lock` files that don't clear.
- Wrangler builds write to `.wrangler/tmp/<hash>/` with thousands of files per build; iCloud evicts files mid-build causing ENOENT.

## Mitigations (in order of preference)

### 1. Never store build artifacts in iCloud

Our `.gitignore` already excludes:
```
node_modules/
dist/
build/
.wrangler/
.vitest-cache/
coverage/
/tmp/
```

But iCloud doesn't honor `.gitignore` — it still tries to sync those. Two options:

**Option A — exclude from iCloud sync via macOS setting:**
Per-directory: mark `node_modules/` and `.wrangler/` to "Remove from iCloud" via Finder (right-click → "Remove Download"). This tells iCloud to keep the dir stub but not sync contents. New files written inside are local-only.

**Option B (preferred, automatable) — build elsewhere:**
Wire `npm install`, `wrangler dev/deploy`, `vitest` into a `/var/tmp/claudopenai-build/` staging location, mirroring BSI-repo's own `scripts/build-safe.sh` pattern:

```bash
# scripts/build-safe.sh (to be authored)
#!/bin/bash
set -euo pipefail
STAGE="/var/tmp/claudopenai-build"
SOURCE="$PWD"

mkdir -p "$STAGE"
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='dist' \
  --exclude='.wrangler' --exclude='/tmp/' "$SOURCE/" "$STAGE/"

pushd "$STAGE" > /dev/null
npm ci
npm run build
npm test
popd > /dev/null

# Copy artifacts back to source (only what we want in git)
rsync -a "$STAGE/packages/mcp-server/dist/" "$SOURCE/packages/mcp-server/dist/"
```

### 2. Git index lock handling

Add to every `scripts/*.sh`:

```bash
# Clear stale index locks from iCloud races
if [ -f "$PWD/.git/index.lock" ]; then
  if ! pgrep -f "git" > /dev/null; then
    echo "Clearing stale .git/index.lock"
    rm -f "$PWD/.git/index.lock"
  fi
fi
```

### 3. Commit strategy

Commit to git with `--no-verify` **only when pre-commit hook stalls on iCloud sync**. Otherwise, let hooks run. If stall is frequent, configure the hook to skip iCloud-sensitive steps when `$CLAUDOPENAI_BUILD_DIR` is unset.

### 4. Fallback: symlink to non-iCloud path

If iCloud proves untenable after Phase 1:

```bash
# One-time: move contents to ~/code/ClaudOpenAI/ and symlink back to iCloud
mv "$ICLOUD/external/ClaudOpenAI" "$HOME/code/ClaudOpenAI"
ln -s "$HOME/code/ClaudOpenAI" "$ICLOUD/external/ClaudOpenAI"
```

This keeps Austin's preferred *logical* path (inside BSI-repo) while the actual files live on local disk. Hidden from iCloud FileProvider because the symlink target is outside iCloud.

## What we commit to NOW

1. `.gitignore` excludes all build dirs (already done — see repo root `.gitignore`)
2. Document the `/var/tmp/claudopenai-build/` staging pattern in `docs/quickstart.md` during Phase 1 (so future contributors know)
3. `scripts/build-safe.sh` authored in Phase 2 as part of npm package scaffolding
4. If any of Phase 1 authoring / Phase 2 tests stall: escalate to fallback #4 (symlink)

## What we monitor

- Anything that fails with ENOENT on a file that should exist → iCloud eviction suspected
- `git status` hangs > 5s → index lock contention suspected
- `npm install` on a new machine against this repo taking > 10min → iCloud sync blocking

## Conclusion

iCloud is tolerable for text editing and git. It's not tolerable for build artifacts. `.gitignore` + build-staging pattern is sufficient for Phase 1. Escalate to symlink if Phase 2 gets flaky.
