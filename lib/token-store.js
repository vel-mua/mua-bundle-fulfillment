async function redis(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured.");
  const response = await fetch(`${url}/${[command, ...args].map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Redis request failed.");
  const body = await response.json();
  if (body.error) throw new Error(`Redis command failed: ${body.error}`);
  return body;
}

async function acquireOrderLock(orderId, token) {
  const key = `mua:bundle:order:${orderId}`;
  const response = await redis("set", key, token, "NX", "EX", 120);
  return response.result === "OK";
}

async function releaseOrderLock(orderId, token) {
  const key = `mua:bundle:order:${orderId}`;
  const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
  await redis("eval", script, 1, key, token);
}

async function saveAdminToken(token) {
  await redis("set", "shopify:admin_access_token", token);
}

async function getAdminToken() {
  const result = await redis("get", "shopify:admin_access_token");
  return result.result || null;
}

module.exports = { saveAdminToken, getAdminToken, acquireOrderLock, releaseOrderLock };
