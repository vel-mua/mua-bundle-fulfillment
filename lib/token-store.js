async function redis(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured.");
  const response = await fetch(`${url}/${[command, ...args].map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Redis request failed.");
  return response.json();
}

async function saveAdminToken(token) {
  await redis("set", "shopify:admin_access_token", token);
}

async function getAdminToken() {
  const result = await redis("get", "shopify:admin_access_token");
  return result.result || null;
}

module.exports = { saveAdminToken, getAdminToken };
