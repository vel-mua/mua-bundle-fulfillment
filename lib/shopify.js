const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
const { getAdminToken } = require("./token-store");

async function shopifyGraphql(query, variables) {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = await getAdminToken();
  if (!shop || !token) throw new Error("Shopify shop domain or Admin API access token is not configured.");

  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) throw new Error(`Shopify API request failed with status ${response.status}.`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  return body.data;
}

async function findVariantBySku(sku) {
  const data = await shopifyGraphql(
    `query VariantBySku($query: String!) {
      productVariants(first: 10, query: $query) {
        nodes { id sku price }
      }
    }`,
    { query: `sku:${JSON.stringify(sku)}` },
  );
  const variant = data.productVariants.nodes.find((candidate) => candidate.sku === sku);
  if (!variant) throw new Error(`No Shopify variant found for SKU ${sku}.`);
  return variant;
}

async function beginOrderEdit(orderId) {
  const data = await shopifyGraphql(
    `mutation BeginEdit($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder { id }
        userErrors { field message }
      }
    }`,
    { id: `gid://shopify/Order/${orderId}` },
  );
  const result = data.orderEditBegin;
  if (result.userErrors.length) throw new Error(result.userErrors.map((error) => error.message).join("; "));
  return result.calculatedOrder.id;
}

async function addZeroDollarVariant(calculatedOrderId, variant, component) {
  const added = await shopifyGraphql(
    `mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
      orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
        calculatedLineItem { id }
        userErrors { field message }
      }
    }`,
    { id: calculatedOrderId, variantId: variant.id, quantity: component.quantity },
  );
  const result = added.orderEditAddVariant;
  if (result.userErrors.length) throw new Error(result.userErrors.map((error) => error.message).join("; "));

  const discount = await shopifyGraphql(
    `mutation DiscountComponent($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
      orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
        calculatedLineItem { id }
        userErrors { field message }
      }
    }`,
    {
      id: calculatedOrderId,
      lineItemId: result.calculatedLineItem.id,
      discount: {
        description: `Mua bundle ${component.source} component`,
        fixedValue: String(Number(variant.price) * component.quantity),
      },
    },
  );
  if (discount.orderEditAddLineItemDiscount.userErrors.length) {
    throw new Error(discount.orderEditAddLineItemDiscount.userErrors.map((error) => error.message).join("; "));
  }
}

async function commitOrderEdit(calculatedOrderId) {
  const data = await shopifyGraphql(
    `mutation CommitEdit($id: ID!) {
      orderEditCommit(id: $id, notifyCustomer: false, staffNote: "Mua bundle fulfillment components added automatically") {
        order { id name }
        userErrors { field message }
      }
    }`,
    { id: calculatedOrderId },
  );
  if (data.orderEditCommit.userErrors.length) {
    throw new Error(data.orderEditCommit.userErrors.map((error) => error.message).join("; "));
  }
  return data.orderEditCommit.order;
}

async function registerOrdersCreateWebhook() {
  const appUrl = process.env.SHOPIFY_APP_URL || "https://mua-bundle-fulfillment.vercel.app";
  const data = await shopifyGraphql(
    `mutation RegisterOrdersCreateWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`,
    {
      topic: "ORDERS_CREATE",
      webhookSubscription: { callbackUrl: `${appUrl}/api/webhooks/orders-create`, format: "JSON" },
    },
  );
  const result = data.webhookSubscriptionCreate;
  if (result.userErrors.length) throw new Error(result.userErrors.map((error) => error.message).join("; "));
  return result.webhookSubscription;
}

module.exports = { findVariantBySku, beginOrderEdit, addZeroDollarVariant, commitOrderEdit, registerOrdersCreateWebhook };
