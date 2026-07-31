const { appUrl, signedState } = require("../../lib/oauth");

module.exports = (request, response) => {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!shop || !clientId) return response.status(500).send("Shopify app is not configured.");
  const params = new URLSearchParams({ client_id: clientId, scope: "read_orders,read_products,write_order_edits", redirect_uri: `${appUrl()}/api/auth/callback`, state: signedState() });
  response.redirect(`https://${shop}/admin/oauth/authorize?${params}`);
};
