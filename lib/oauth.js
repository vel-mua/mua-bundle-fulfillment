const crypto = require("node:crypto");

function appUrl() { return process.env.APP_URL || "https://mua-bundle-fulfillment.vercel.app"; }

function signedState() {
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(timestamp).digest("hex");
  return `${timestamp}.${signature}`;
}

function validState(state) {
  const [timestamp, signature] = String(state || "").split(".");
  if (!timestamp || !signature || Date.now() - Number(timestamp) > 10 * 60 * 1000) return false;
  const expected = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(timestamp).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function validHmac(query) {
  const received = query.hmac;
  const message = Object.entries(query).filter(([key]) => key !== "hmac").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
  const expected = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(message).digest("hex");
  return received && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

module.exports = { appUrl, signedState, validState, validHmac };
