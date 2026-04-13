/**
 * KV-backed per-IP rate limiter. 60 requests per minute default.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

export async function rateLimit(
  req: Request,
  kv: KVNamespace,
  options: { rpm: number },
): Promise<RateLimitResult> {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / 60); // 1-minute bucket
  const key = `rl:${ip}:${bucket}`;

  const existing = await kv.get(key, "text");
  const count = existing ? Number.parseInt(existing, 10) : 0;

  if (count >= options.rpm) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: 60 - (now % 60),
    };
  }

  // KV is eventually consistent; for stricter guarantees use Durable Objects
  await kv.put(key, String(count + 1), { expirationTtl: 120 });

  return {
    ok: true,
    remaining: options.rpm - count - 1,
    retryAfter: 0,
  };
}
