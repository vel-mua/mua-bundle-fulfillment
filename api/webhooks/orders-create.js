const crypto = require("node:crypto");
const { componentPlan, existingComponentKeys } = require("../../lib/bundle-plan");
const { findVariantBySku, beginOrderEdit, addZeroDollarVariant, commitOrderEdit } = require("../../lib/shopify");

function rawBody(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body);
  return Buffer.from(JSON.stringify(request.body || {}));
}

function isValidWebhook(request) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const hmac = request.headers["x-shopify-hmac-sha256"];
  if (!secret || !hmac) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody(request)).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!isValidWebhook(request)) return response.status(401).json({ error: "Invalid webhook signature" });

  try {
    const order = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    if (order.fulfillment_status && order.fulfillment_status !== "unfulfilled") {
      return response.status(200).json({ status: "skipped", reason: "Order is already fulfilled" });
    }

    const existing = existingComponentKeys(order);
    const plan = componentPlan(order).filter((component) => !existing.has(`${component.group}:${component.sku}`));
    if (!plan.length) return response.status(200).json({ status: "skipped", reason: "No new bundle components" });

    const editId = await beginOrderEdit(order.id);
    for (const component of plan) {
      const variant = await findVariantBySku(component.sku);
      await addZeroDollarVariant(editId, variant, component);
    }
    const editedOrder = await commitOrderEdit(editId);
    return response.status(200).json({ status: "processed", order: editedOrder.name, components: plan.length });
  } catch (error) {
    console.error("Bundle fulfillment webhook failed", error);
    return response.status(500).json({ error: "Bundle fulfillment could not be completed." });
  }
};
