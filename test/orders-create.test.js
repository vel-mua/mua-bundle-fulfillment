const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const ordersCreate = require("../api/webhooks/orders-create");

const pouchSkus = ["MUA-HYD-TN-15PK", "MUA-HYD-IB-15PK", "MUA-HYD-GS-15PK"];

function bundleParent() {
  return {
    id: "gid://shopify/LineItem/1",
    sku: "MUA-TOLU-BUN-26",
    currentQuantity: 1,
    customAttributes: [
      { key: "_bundle_primary", value: "true" },
      { key: "_bundle_group", value: "renewal-1" },
      { key: "_inventory_plan", value: "1x MUA-HYD-TN-15PK, 1x MUA-HYD-IB-15PK, 1x MUA-HYD-GS-15PK" },
      { key: "_launch_extras", value: "1x MW-STCKRPACK-1, 1x MW-FROTH-1, 1x LW-SSTS-3XL" },
    ],
    sellingPlan: null,
    discountedUnitPriceSet: { shopMoney: { amount: "55.88" } },
  };
}

function snapshot(withComponents) {
  const lines = [bundleParent()];
  if (withComponents) {
    for (const [index, sku] of pouchSkus.entries()) {
      lines.push({
        id: `gid://shopify/LineItem/${index + 2}`,
        sku,
        currentQuantity: 1,
        customAttributes: [],
        sellingPlan: null,
        discountedUnitPriceSet: { shopMoney: { amount: "0.0" } },
      });
    }
  }
  return {
    id: "gid://shopify/Order/6434881634356",
    createdAt: "2026-09-09T06:05:26Z",
    sourceName: "subscription_contract_checkout_one",
    tags: [],
    displayFulfillmentStatus: "UNFULFILLED",
    lineItems: { nodes: lines, pageInfo: { hasNextPage: false, endCursor: null } },
  };
}

async function deliverWebhook(secret, lineItems = [{ sku: "MUA-TOLU-BUN-26" }]) {
  const body = Buffer.from(JSON.stringify({
    id: 6434881634356,
    tags: [],
    line_items: lineItems,
  }));
  const request = new EventEmitter();
  request.method = "POST";
  request.headers = {
    "x-shopify-hmac-sha256": crypto.createHmac("sha256", secret).update(body).digest("base64"),
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  const pending = ordersCreate(request, response);
  request.emit("data", body);
  request.emit("end");
  await pending;
  return response;
}

test("a tagless Tolu renewal adds only three free pouches and a replay adds none", async (t) => {
  const previousFetch = global.fetch;
  const previousEnv = Object.fromEntries([
    "SHOPIFY_API_SECRET", "SHOPIFY_SHOP_DOMAIN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  ].map((key) => [key, process.env[key]]));
  t.after(() => {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const secret = "test-webhook-secret";
  process.env.SHOPIFY_API_SECRET = secret;
  process.env.SHOPIFY_SHOP_DOMAIN = "example.myshopify.com";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-redis-token";

  let replay = false;
  let lockBusy = false;
  const lookedUpSkus = [];
  const discounts = [];
  let mutationCount = 0;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://redis.test/")) {
      if (String(url).includes("/set/")) {
        return { ok: true, json: async () => ({ result: lockBusy ? null : "OK" }) };
      }
      if (String(url).includes("/eval/")) {
        return { ok: true, json: async () => ({ result: 1 }) };
      }
      return { ok: true, json: async () => ({ result: "test-admin-token" }) };
    }
    assert.equal(url, "https://example.myshopify.com/admin/api/2026-07/graphql.json");
    const { query, variables } = JSON.parse(options.body);
    let data;
    if (query.includes("query BundleOrderSnapshot")) {
      data = { order: snapshot(replay) };
    } else if (query.includes("query VariantBySku")) {
      const sku = JSON.parse(variables.query.slice(4));
      lookedUpSkus.push(sku);
      data = { productVariants: { nodes: [{ id: `gid://shopify/ProductVariant/${sku}`, sku, price: "25.99" }] } };
    } else if (query.includes("mutation BeginEdit")) {
      mutationCount++;
      data = { orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/1" }, userErrors: [] } };
    } else if (query.includes("mutation AddVariant")) {
      mutationCount++;
      data = { orderEditAddVariant: { calculatedLineItem: { id: `gid://shopify/CalculatedLineItem/${mutationCount}` }, userErrors: [] } };
    } else if (query.includes("mutation DiscountComponent")) {
      mutationCount++;
      discounts.push(variables.discount);
      data = { orderEditAddLineItemDiscount: { userErrors: [] } };
    } else if (query.includes("mutation CommitEdit")) {
      mutationCount++;
      data = { orderEditCommit: { order: { id: "gid://shopify/Order/6434881634356", name: "#1564" }, userErrors: [] } };
    } else {
      assert.fail(`Unexpected Shopify operation: ${query}`);
    }
    return { ok: true, json: async () => ({ data }) };
  };

  const first = await deliverWebhook(secret);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { status: "processed", order: "#1564", components: 3 });
  assert.deepEqual(lookedUpSkus, pouchSkus);
  assert.equal(discounts.length, 3);
  assert.ok(discounts.every((discount) => discount.fixedValue.amount === "25.99"));
  assert.ok(discounts.every((discount) => discount.description === "Mua bundle pouch component"));

  replay = true;
  const beforeReplay = mutationCount;
  const second = await deliverWebhook(secret);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.body, { status: "skipped", reason: "No new bundle components" });
  assert.equal(mutationCount, beforeReplay);

  lockBusy = true;
  const overlapping = await deliverWebhook(secret);
  assert.equal(overlapping.statusCode, 200);
  assert.deepEqual(overlapping.body, { status: "skipped", reason: "Order is already being processed" });
  assert.equal(mutationCount, beforeReplay);
});

test("non-bundle orders do not use the Admin API or the order lock", async (t) => {
  const priorSecret = process.env.SHOPIFY_API_SECRET;
  const priorFetch = global.fetch;
  t.after(() => {
    global.fetch = priorFetch;
    if (priorSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = priorSecret;
  });
  process.env.SHOPIFY_API_SECRET = "test-webhook-secret";
  global.fetch = () => assert.fail("A non-bundle order should not call external services.");

  const result = await deliverWebhook("test-webhook-secret", [{ sku: "MUA-HYD-TN-15PK" }]);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { status: "skipped", reason: "No bundle items" });
});
