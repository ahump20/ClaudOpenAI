# 07 — R2 Storage Patterns

The `universal-skills-content` R2 bucket holds the actual skill content bytes. D1 holds metadata. R2 holds bodies, reference files, and binary assets.

## Bucket: `universal-skills-content`

Single bucket. Versioned by key path.

## Key structure

```
skills/{id}/{version}/skill.md           # Parsed SKILL.md (body only, no frontmatter separator)
skills/{id}/{version}/skill.full.md      # Original SKILL.md including frontmatter
skills/{id}/{version}/canonical.json     # CanonicalSkill JSON (full record)
skills/{id}/{version}/references.tgz     # All references/ files tarballed
skills/{id}/{version}/scripts.tgz        # All scripts/ tarballed, mode bits preserved
skills/{id}/{version}/assets/<path>      # Individual asset files (binary, served directly)
skills/{id}/{version}/manifest.json      # The original plugin.json or SKILL.md envelope
```

- `{id}` is the canonical skill ID: `{source-namespace}/{name}`. Slashes in the path preserve the hierarchy.
- `{version}` is semver from `skills.version` or synthetic (`v+<commit-sha[0:7]>` for Claude plugins without versions).
- All content addressed — we never mutate an existing `{id}/{version}/*` key. New versions get new paths.

## Example

```
skills/anthropics-skills/pdf/0.3.1/skill.md
skills/anthropics-skills/pdf/0.3.1/skill.full.md
skills/anthropics-skills/pdf/0.3.1/canonical.json
skills/anthropics-skills/pdf/0.3.1/references.tgz
skills/anthropics-skills/pdf/0.3.1/assets/sample.pdf
skills/anthropics-skills/pdf/0.3.2/...                   # next version, separate tree
skills/openai-plugins/canva/1.0.0/skill.md
...
```

## Metadata headers

Every object uploaded with:

- `content-type` — `text/markdown` for `.md`, `application/json` for `.json`, `application/gzip` for `.tgz`, mime-detected for individual assets
- `cache-control: public, max-age=86400, immutable` — safe because content-addressed; never changes
- `etag: sha256:<hash>` — user-defined ETag set to the content's sha256 (lets clients verify)
- `x-claudopenai-source: {source-repo}@{commit}` — custom header for auditability
- `x-claudopenai-indexed-at: {ISO8601}` — custom header

## Presigned URL generation

For `get-skill-content` with `include=["assets"]`, the API Worker returns presigned R2 URLs instead of inline bytes:

```ts
import { AwsClient } from "aws4fetch";

async function presignR2Url(env: Env, key: string, ttl_seconds = 3600): Promise<string> {
  // Use R2's S3-compatible API with temporary creds
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
  });

  const url = new URL(`https://${env.R2_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`);
  url.searchParams.set("X-Amz-Expires", String(ttl_seconds));
  const signed = await aws.sign(url.toString(), { aws: { signQuery: true }});
  return signed.url;
}
```

1-hour TTL default. Clients fetch directly from R2 (saves Worker CPU + bandwidth).

## Caching via CDN

R2 serves via Cloudflare's CDN automatically. With `cache-control: public, max-age=86400, immutable`:

- First request from a given PoP: R2 origin
- Subsequent requests for 24h: CDN cache (no R2 cost)
- `immutable` = browser never revalidates (perfect for content-addressed keys)

## Upload pattern (indexer)

```ts
async function uploadSkillContent(env: Env, canonical: CanonicalSkill) {
  const { id, version } = canonical;
  const prefix = `skills/${id}/${version}`;

  // 1. Canonical JSON
  await env.CONTENT.put(`${prefix}/canonical.json`, JSON.stringify(canonical, null, 2), {
    httpMetadata: {
      contentType: "application/json",
      cacheControl: "public, max-age=86400, immutable",
    },
    customMetadata: {
      "source": `${canonical.origin.sourcePath}@${canonical.origin.sourceSha}`,
      "indexedAt": new Date().toISOString(),
    },
  });

  // 2. Each skill's SKILL.md (body)
  for (const skill of canonical.skills) {
    const skillPrefix = `${prefix}/skills/${skill.name}`;
    await env.CONTENT.put(`${skillPrefix}/SKILL.md`, skill.body, { httpMetadata: { contentType: "text/markdown", ... }});

    // 3. References tarball (bundle — avoid hundreds of small R2 ops)
    if (skill.references.length > 0) {
      const tarball = await createTarGz(skill.references);
      await env.CONTENT.put(`${skillPrefix}/references.tgz`, tarball, { httpMetadata: { contentType: "application/gzip" }});
    }

    // 4. Individual assets (served individually — R2 handles binary well)
    for (const asset of skill.assets) {
      await env.CONTENT.put(`${skillPrefix}/assets/${asset.path}`, asset.bytes, {
        httpMetadata: { contentType: asset.mime, cacheControl: "public, max-age=86400, immutable" },
      });
    }
  }
}
```

## Tarball vs individual-file decision

- **Tarball references & scripts**: typically text, small, loaded together. One HTTP round-trip vs N. Win.
- **Individual assets**: often binary, may be large, loaded individually. Keep per-file so clients fetch only what they need.

## Garbage collection

When a skill is tombstoned (`skills.tombstoned = 1`), its R2 objects are NOT immediately deleted. Kept for 30 days for rollback. Scheduled cleanup job (`indexer` worker, weekly cron):

```ts
async function gcTombstoned(env: Env) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stale = await env.DB.prepare(`
    SELECT id FROM skills WHERE tombstoned = 1 AND last_verified < ?
  `).bind(cutoff).all<{ id: string }>();

  for (const { id } of stale.results) {
    // List objects under skills/{id}/
    let cursor: string | undefined;
    do {
      const list = await env.CONTENT.list({ prefix: `skills/${id}/`, cursor });
      for (const obj of list.objects) {
        await env.CONTENT.delete(obj.key);
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Finally remove the skill row entirely
    await env.DB.prepare(`DELETE FROM skills WHERE id = ?`).bind(id).run();
  }
}
```

## Storage cost estimate

At 10,000 skills, each ~100KB of canonical+SKILL.md+refs+assets:

- 10,000 × 100KB = 1 GB
- R2 free tier: 10 GB storage, 1M Class-A (write) ops / month, 10M Class-B (read) ops / month
- **Expected spend: $0/month for v0.1**

## Security

- R2 bucket is **not public** — clients always go through Workers (api + bridge)
- Presigned URLs have short TTL (1 hour)
- No user-uploaded content in R2 — only indexer writes. Keys come from trusted inputs (upstream repo paths), but still normalized + sanitized.

## Keys containing `/` — naming safety

`{id}` has form `{owner}/{name}` (e.g. `anthropics-skills/pdf`). R2 treats `/` as part of the key name; it does NOT imply hierarchy at the storage layer. But the Cloudflare dashboard UI renders `/` as folder separators for browsing convenience.

When constructing keys:
- Escape `..` (path traversal)
- Reject keys with control chars (`\x00`-`\x1f`)
- Length limit: 1024 chars (R2 max)

Normalize via:

```ts
function canonicalizeKey(parts: string[]): string {
  return parts
    .map(p => p.replace(/\.\.\/|\.\.\\/g, ""))       // strip path-traversal
    .map(p => p.replace(/[\x00-\x1f]/g, ""))          // strip control chars
    .map(p => p.replace(/^\/+|\/+$/g, ""))            // strip leading/trailing slashes
    .join("/");
}
```

## Verification checks

After each upload, the indexer optionally verifies by reading the object's ETag and comparing against the expected sha256:

```ts
const uploaded = await env.CONTENT.head(key);
if (uploaded?.httpEtag !== `"sha256:${expectedHash}"`) {
  logger.error(`R2 upload verification failed for ${key}`);
  // Retry or alert
}
```

## See also

- [`06-d1-schema-design.md`](06-d1-schema-design.md) — D1 metadata that points to these R2 keys
- [`04-mcp-tool-design.md`](04-mcp-tool-design.md) — how `get-skill-content` uses R2
- [`08-github-indexer-design.md`](08-github-indexer-design.md) — how the indexer populates R2
