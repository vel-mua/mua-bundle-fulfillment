const { appUrl, validHmac, validState } = require("../../lib/oauth");
const { saveAdminToken } = require("../../lib/token-store");

module.exports = async (request, response) => {
  const { shop, code, state } = request.query;
  if (shop !== process.env.SHOPIFY_SHOP_DOMAIN || !code || !validState(state) || !validHmac(request.query)) return response.status(401).send("Invalid Shopify authorization response.");
  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_API_SECRET, code }) });
  if (!tokenResponse.ok) return response.status(502).send("Shopify could not issue an access token.");
  const { access_token } = await tokenResponse.json();
  await saveAdminToken(access_token);
  response.status(200).send("Mua Bundle Fulfillment is connected. You can close this window.");
};
