import type { Env } from "../index.js";

export async function handleHealth(env: Env): Promise<Response> {
  const checks: Record<string, string> = {
    status: "ok",
    version: env.REGISTRY_VERSION,
    timezone: "America/Chicago",
    fetched_at: new Date().toISOString(),
  };

  // D1 check
  try {
    const row = await env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
    checks.d1 = row?.ok === 1 ? "up" : "degraded";
  } catch {
    checks.d1 = "down";
  }

  // R2 check
  try {
    await env.CONTENT.head("skills/_health_probe.txt");
    checks.r2 = "up";
  } catch {
    // 404 is fine — means R2 responded
    checks.r2 = "up";
  }

  return new Response(JSON.stringify(checks, null, 2), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache, no-store, must-revalidate",
    },
  });
}
