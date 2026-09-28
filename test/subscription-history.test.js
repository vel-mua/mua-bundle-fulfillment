const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const ordersCreate = require("../api/webhooks/orders-create");
const history = require("./fixtures/subscription-history.json");

// These expectations came from the saved Pouch 1..5 selections, independently
// cross-checked against the Flavors summary, not from the inventory-plan parser.
const totals = (lines) => lines.reduce((out, line) => {
  out[line.sku] = (out[line.sku] || 0) + line.currentQuantity;
  return out;
}, {});

async function exerciseRenewal(t, fixture, existing = [], { initial = false, addedUnitPrice = "25.99" } = {}) {
  const expectedComponents = { ...fixture.expectedPouches, ...(initial ? fixture.expectedGifts : {}) };
  const sourceName = initial ? "web" : "subscription_contract_checkout_one";
  const secret = "history-test-secret";
  const env = {
    SHOPIFY_API_SECRET: secret,
    SHOPIFY_SHOP_DOMAIN: "history-test.myshopify.com",
    UPSTASH_REDIS_REST_URL: "https://history-redis.test",
    UPSTASH_REDIS_REST_TOKEN: "history-test-token",
    SHOPIFY_CURRENCY: "USD",
  };
  const beforeEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(beforeEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let nextId = 100;
  const originalLines = fixture.lines.map((line, i) => ({
    id: `gid://shopify/LineItem/${i + 1}`,
    sku: line.sku,
    currentQuantity: line.quantity,
    customAttributes: line.properties.map(p => ({ key: p.name, value: p.value })),
    // Renewal identification must work before tags/selling plans are populated.
    sellingPlan: initial ? { sellingPlanId: "gid://shopify/SellingPlan/1" } : null,
    discountedUnitPriceSet: { shopMoney: { amount: "50.00" } },
  }));
  const freeLines = existing.map(line => ({
    id: `gid://shopify/LineItem/${nextId++}`,
    sku: line.sku, currentQuantity: line.quantity, customAttributes: [], sellingPlan: null,
    discountedUnitPriceSet: { shopMoney: { amount: line.price } },
  }));
  let committedLines = [...originalLines, ...freeLines];
  let stagedLines;
  let mutations = 0;
  let commits = 0;
  const originalCopy = structuredClone(committedLines);
  t.mock.method(global, "fetch", async (url, options) => {
    if (String(url).startsWith(env.UPSTASH_REDIS_REST_URL + "/")) {
      return { ok: true, json: async () => ({ result: String(url).includes("/set/") ? "OK" : "test-admin-token" }) };
    }
    assert.equal(new URL(url).host, env.SHOPIFY_SHOP_DOMAIN);
    const { query, variables } = JSON.parse(options.body);
    if (query.includes("mutation ")) mutations++;
    let data;
    if (query.includes("query BundleOrderSnapshot")) {
      data = { order: {
        id: "gid://shopify/Order/1", createdAt: "2026-10-01T00:00:00Z",
        sourceName, tags: [], displayFulfillmentStatus: "UNFULFILLED",
        lineItems: { nodes: committedLines, pageInfo: { hasNextPage: false } },
      } };
    } else if (query.includes("query VariantBySku")) {
      const sku = JSON.parse(variables.query.slice(4));
      assert.ok(Object.hasOwn(expectedComponents, sku), `Unexpected gift or flavor: ${sku}`);
      data = { productVariants: { nodes: [{ id: sku, sku, price: "25.99" }] } };
    } else if (query.includes("mutation BeginEdit")) {
      stagedLines = structuredClone(committedLines);
      data = { orderEditBegin: { calculatedOrder: { id: "edit-1" }, userErrors: [] } };
    } else if (query.includes("mutation AddVariant")) {
      // Model Shopify's documented default: the same variant cannot be added
      // again unless allowDuplicates is explicitly true, even within one edit.
      const alreadyPresent = stagedLines.some(line => line.sku === variables.variantId);
      const duplicatesAllowed = /allowDuplicates:\s*true\b/.test(query);
      if (alreadyPresent && !duplicatesAllowed) {
        data = { orderEditAddVariant: { calculatedLineItem: null, userErrors: [{ message: "Variant already exists on calculated order" }] } };
      } else {
        const added = {
          id: `gid://shopify/CalculatedLineItem/${nextId++}`, sku: variables.variantId,
          currentQuantity: variables.quantity, customAttributes: [], sellingPlan: null,
          discountedUnitPriceSet: { shopMoney: { amount: addedUnitPrice } },
        };
        stagedLines.push(added);
        data = { orderEditAddVariant: { calculatedLineItem: { id: added.id }, userErrors: [] } };
      }
    } else if (query.includes("mutation DiscountComponent")) {
      const line = stagedLines.find(line => line.id === variables.lineItemId);
      assert.ok(line);
      assert.equal(variables.discount.description, `Mua bundle ${Object.hasOwn(fixture.expectedPouches, line.sku) ? "pouch" : "gift"} component`);
      assert.equal(variables.discount.percentValue, 100);
      assert.equal(Object.hasOwn(variables.discount, "fixedValue"), false);
      line.discountedUnitPriceSet.shopMoney.amount = "0.00";
      data = { orderEditAddLineItemDiscount: { userErrors: [] } };
    } else if (query.includes("mutation CommitEdit")) {
      assert.match(query, /notifyCustomer:\s*false/);
      assert.deepEqual(stagedLines.slice(0, originalCopy.length), originalCopy);
      assert.ok(stagedLines.slice(originalCopy.length).every(line => Number(line.discountedUnitPriceSet.shopMoney.amount) === 0));
      committedLines = stagedLines;
      commits++;
      data = { orderEditCommit: { order: { id: "gid://shopify/Order/1", name: fixture.caseId }, userErrors: [] } };
    } else {
      assert.fail(`Unexpected operation: ${query}`);
    }
    return { ok: true, json: async () => ({ data }) };
  });

  async function deliver() {
    const body = Buffer.from(JSON.stringify({ id: 1, source_name: sourceName, tags: [], line_items: fixture.lines }));
    const request = new EventEmitter();
    request.method = "POST";
    request.headers = { "x-shopify-hmac-sha256": crypto.createHmac("sha256", secret).update(body).digest("base64") };
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const pending = ordersCreate(request, response);
    request.emit("data", body);
    request.emit("end");
    await pending;
    return response;
  }

  const first = await deliver();
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const hasBundle = Object.keys(expectedComponents).length > 0;
  assert.equal(first.body.status, hasBundle ? "processed" : "skipped");
  assert.equal(commits, hasBundle ? 1 : 0);
  assert.deepEqual(totals(committedLines.filter(line => Number(line.discountedUnitPriceSet.shopMoney.amount) === 0)), expectedComponents);
  assert.deepEqual(committedLines.slice(0, originalCopy.length), originalCopy);
  const beforeReplay = mutations;
  const second = await deliver();
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.status, "skipped");
  assert.equal(mutations, beforeReplay, "A replay must not add any items");
}

for (const fixture of history) {
  test(`${fixture.caseId}: ${fixture.cohort} format renews pouch-only and replays safely`, t => exerciseRenewal(t, fixture));
}

const twoBundles = history.find(f => f.lines.filter(l => l.sku === "MUA-LIMA-BUN-26").length === 2);
test("two Lima subscriptions retain ten pouches when some free components already exist", t => exerciseRenewal(t, twoBundles, [
  { sku: "MUA-HYD-TN-15PK", quantity: 3, price: "0.00" },
  { sku: "MUA-HYD-IB-15PK", quantity: 1, price: "0.00" },
]));
test("a paid same-flavor pouch does not block or replace free bundle pouches", t => exerciseRenewal(t, twoBundles, [
  { sku: "MUA-HYD-TN-15PK", quantity: 2, price: "25.99" },
]));

const multipleTasi = require("./fixtures/multiple-tasi.json");
test("MUA1656: first subscription adds three Golden Sunrise, one Tropical Nectar, and four stickers", t =>
  exerciseRenewal(t, multipleTasi, [], { initial: true }));
test("MUA1656: renewal adds four pouches with no stickers", t => exerciseRenewal(t, multipleTasi));
test("MUA1656: components stay free when Shopify's order price differs from the catalog price", t =>
  exerciseRenewal(t, multipleTasi, [], { initial: true, addedUnitPrice: "29.50" }));
test("MUA1656: partial first-order repair adds only remaining pouches and stickers", t =>
  exerciseRenewal(t, multipleTasi, [
    { sku: "MUA-HYD-GS-15PK", quantity: 2, price: "0.00" },
    { sku: "MW-STCKRPACK-1", quantity: 1, price: "0.00" },
  ], { initial: true }));
