# Spike S5 — Cloudflare DNS Setup

**Status:** Documentation only — requires Austin's Cloudflare account action before Phase 3 worker deploys.

## Target subdomains

All under the existing `blazesportsintel.com` zone. Proxied through Cloudflare (orange cloud) for SSL + edge caching.

| Subdomain | Worker | Purpose |
|-----------|--------|---------|
| `marketplace.blazesportsintel.com` | `universal-skills-bridge` | Landing + `/.claude-plugin/marketplace.json` + `/.agents/plugins/marketplace.json` |
| `api.marketplace.blazesportsintel.com` | `universal-skills-api` | HTTP MCP endpoint (`POST /mcp`) |
| `indexer.marketplace.blazesportsintel.com` | `universal-skills-indexer` | Cron-only; exposes `/health` and manual `/run` admin endpoints |
| `registry.marketplace.blazesportsintel.com` | `universal-skills-bridge` (alias) | Alias for `marketplace.*` used by SDK clients |

## How to add — two paths

### Option A (Recommended) — Wrangler `routes` block

In each Worker's `wrangler.toml`:

```toml
# workers/universal-skills-api/wrangler.toml
[[routes]]
pattern = "api.marketplace.blazesportsintel.com/*"
zone_name = "blazesportsintel.com"
custom_domain = true
```

Wrangler creates the DNS record + worker binding on first deploy. Requires:
- Cloudflare account token with `Zone:Edit` + `Workers Scripts:Edit` permissions
- Account already in `wrangler whoami` output

### Option B — Manual Cloudflare dashboard

1. Open Cloudflare dashboard → `blazesportsintel.com` zone → DNS records
2. Add `CNAME` records:
   - `marketplace` → `universal-skills-bridge.<account>.workers.dev` (proxied)
   - `api.marketplace` → `universal-skills-api.<account>.workers.dev` (proxied)
   - `indexer.marketplace` → `universal-skills-indexer.<account>.workers.dev` (proxied)
   - `registry.marketplace` → `universal-skills-bridge.<account>.workers.dev` (proxied)
3. Workers → each worker → Triggers → Add Custom Domain → enter the subdomain → Save

## SSL verification post-deploy

```bash
for h in marketplace api.marketplace indexer.marketplace registry.marketplace; do
  echo "=== $h.blazesportsintel.com ==="
  curl -sI "https://$h.blazesportsintel.com/health" | head -5
done
```

Expected on each:
- HTTP/2 200
- `server: cloudflare`
- `content-type: application/json`

## Blocked until: S5 complete

Phase 3 tasks P3-1 (provision) and P3-6 (custom domains binding) both depend on the subdomains existing. If S5 blocks, Phase 3 ships on `*.<account>.workers.dev` subdomains with a README note that custom domains follow when the user runs the wrangler commands.

## Action needed

Austin: either
1. Confirm `wrangler whoami` shows `blazesportsintel.com` access + run `wrangler deploy` with the routes block above at Phase 3, OR
2. Pre-create the CNAMEs via dashboard before Phase 3 starts.

Either is fine. Option A is more repeatable; Option B lets you preview the DNS before any Worker deploys.
