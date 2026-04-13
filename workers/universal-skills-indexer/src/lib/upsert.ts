/**
 * UPSERT a canonical record into D1 + stream content to R2.
 * Returns true iff something actually changed.
 */
import type { CanonicalRecord } from "./normalize.js";

export async function upsertSkill(
  db: D1Database,
  r2: R2Bucket,
  record: CanonicalRecord,
): Promise<boolean> {
  // Check existing content_hash
  const existing = await db
    .prepare("SELECT content_hash FROM skills WHERE id = ?")
    .bind(record.id)
    .first<{ content_hash: string } | null>();

  if (existing && existing.content_hash === record.content_hash) {
    // No change; just bump last_verified
    await db
      .prepare("UPDATE skills SET last_verified = ? WHERE id = ?")
      .bind(new Date().toISOString(), record.id)
      .run();
    return false;
  }

  const now = new Date().toISOString();
  const version = record.version ?? `v-${record.source_commit.slice(0, 7)}`;

  // UPSERT skills
  await db
    .prepare(
      `INSERT INTO skills (
        id, name, description, source_ecosystem, source_url, source_repo, source_commit,
        source_path, manifest_format, quality_score, content_hash, compat_claude, compat_codex,
        tags, category, last_verified, indexed_at, tombstoned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        source_url = excluded.source_url,
        source_commit = excluded.source_commit,
        source_path = excluded.source_path,
        manifest_format = excluded.manifest_format,
        quality_score = excluded.quality_score,
        content_hash = excluded.content_hash,
        compat_claude = excluded.compat_claude,
        compat_codex = excluded.compat_codex,
        tags = excluded.tags,
        category = excluded.category,
        last_verified = excluded.last_verified,
        indexed_at = excluded.indexed_at,
        tombstoned = 0`,
    )
    .bind(
      record.id,
      record.name,
      record.description,
      record.source_ecosystem,
      record.source_url,
      record.source_repo,
      record.source_commit,
      record.source_path,
      record.manifest_format,
      record.quality_score,
      record.content_hash,
      record.compat_claude,
      record.compat_codex,
      record.tags,
      record.category,
      now,
      now,
    )
    .run();

  // Append version row (idempotent)
  await db
    .prepare(
      `INSERT INTO skill_versions (skill_id, version, content_hash, source_commit, indexed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(skill_id, version) DO UPDATE SET content_hash = excluded.content_hash, indexed_at = excluded.indexed_at`,
    )
    .bind(record.id, version, record.content_hash, record.source_commit, now)
    .run();

  // Stream body to R2 when present
  if (record.body) {
    const key = `skills/${record.id}/${version}/skill.md`;
    await r2.put(key, record.body, {
      httpMetadata: {
        contentType: "text/markdown",
        cacheControl: "public, max-age=86400, immutable",
      },
      customMetadata: {
        source: `${record.source_repo}@${record.source_commit}`,
        indexed_at: now,
      },
    });
  }

  return true;
}
