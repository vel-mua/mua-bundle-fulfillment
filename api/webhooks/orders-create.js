const crypto = require("node:crypto");
const {
  BundlePlanValidationError,
  componentPlan,
  hasBundleCandidate,
  missingComponents,
} = require("../../lib/bundle-plan");
const { findVariantBySku, getOrderSnapshot, beginOrderEdit, addZeroDollarVariant, commitOrderEdit } = require("../../lib/shopify");
const { acquireOrderLock, releaseOrderLock } = require("../../lib/token-store");

function rawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function isValidWebhook(body, request) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const hmac = request.headers["x-shopify-hmac-sha256"];
  if (!secret || !hmac) return false;
  const digest = crypto.createHmac("sha256", secret).update(body).digest("base64");
  const provided = Buffer.from(hmac);
  const expected = Buffer.from(digest);
  return provided.length === expected.length && crypto.timingSafeEqual(expected, provided);
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });

  try {
    const body = await rawBody(request);
    if (!isValidWebhook(body, request)) return response.status(401).json({ error: "Invalid webhook signature" });
    const webhookOrder = JSON.parse(body.toString("utf8"));
    if (!webhookOrder.id) throw new BundlePlanValidationError("Order ID is missing.");
    if (!Array.isArray(webhookOrder.line_items)) throw new Error("Order webhook is missing line items.");
    if (!hasBundleCandidate(webhookOrder)) {
      return response.status(200).json({ status: "skipped", reason: "No bundle items" });
    }
    const lockToken = crypto.randomUUID();
    if (!await acquireOrderLock(webhookOrder.id, lockToken)) {
      return response.status(200).json({ status: "skipped", reason: "Order is already being processed" });
    }
    try {
      const order = await getOrderSnapshot(webhookOrder.id);
      if (!order.source_name && webhookOrder.source_name) {
        order.source_name = webhookOrder.source_name;
      }
      if ((!order.tags || !order.tags.length) && webhookOrder.tags) {
        order.tags = webhookOrder.tags;
      }
      if (order.fulfillment_status !== "unfulfilled") {
        return response.status(200).json({ status: "skipped", reason: "Order is already fulfilled" });
      }

      const plan = missingComponents(componentPlan(order), order);
      if (!plan.length) return response.status(200).json({ status: "skipped", reason: "No new bundle components" });

      const editId = await beginOrderEdit(order.id);
      for (const component of plan) {
        const variant = await findVariantBySku(component.sku);
        await addZeroDollarVariant(editId, variant, component);
      }
      const editedOrder = await commitOrderEdit(editId);
      return response.status(200).json({ status: "processed", order: editedOrder.name, components: plan.length });
    } finally {
      await releaseOrderLock(webhookOrder.id, lockToken).catch((error) => {
        console.error("Could not release bundle order lock", error);
      });
    }
  } catch (error) {
    if (error instanceof BundlePlanValidationError) {
      console.error("Bundle fulfillment rejected an invalid plan", error);
      return response.status(422).json({
        error: "Invalid bundle plan.",
        details: error.message,
      });
    }
    console.error("Bundle fulfillment webhook failed", error);
    return response.status(500).json({ error: "Bundle fulfillment could not be completed." });
  }
};

module.exports.config = { api: { bodyParser: false } };
