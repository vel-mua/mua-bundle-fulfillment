const { saveAdminToken } = require("./token-store");

async function exchangeSessionToken(sessionToken) {
  if (!sessionToken) throw new Error("Missing Shopify session token.");

  const body = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
  });

  const result = await fetch(`https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!result.ok) {
    console.error("Shopify token exchange failed", result.status, await result.text());
    throw new Error("Shopify token exchange failed.");
  }

  const { access_token } = await result.json();
  await saveAdminToken(access_token);
}

module.exports = { exchangeSessionToken };
