const { exchangeSessionToken } = require("../../lib/session-token");
const { registerOrdersCreateWebhook } = require("../../lib/shopify");

module.exports = async (request, response) => {
  const sessionToken = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (request.method !== "POST" || !sessionToken) return response.status(401).send("Missing Shopify session token.");

  try {
    await exchangeSessionToken(sessionToken);
    const webhook = await registerOrdersCreateWebhook();
    response.status(200).json({ registered: true, webhookId: webhook.id });
  } catch (error) {
    console.error("Shopify webhook registration failed", error);
    response.status(500).send("Shopify webhook registration failed.");
  }
};
