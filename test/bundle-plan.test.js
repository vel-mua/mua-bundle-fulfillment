const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BundlePlanValidationError,
  DEFAULT_LIMA_OFFER_CUTOVER_AT,
  DEFAULT_TOLU_OFFER_CUTOVER_AT,
  componentPlan,
} = require("../lib/bundle-plan");

const POST_CUTOVER = "2026-08-20T16:57:34Z";
const PRE_CUTOVER = "2026-08-10T06:24:22Z";
const CURRENT_LIMA_EXTRAS = "1x MW-STCKRPACK-1, 1x MW-FROTH-1";
const LEGACY_LIMA_EXTRAS = "1x MW-FROTH-1, 1x MW-STCKRPACK-1, 1x MW-TOTBG-1, 1x MW-BTTL-BLACK, 1x LW-SSTS-3XL";

function order(values = {}) {
  return { created_at: POST_CUTOVER, ...values };
}

function bundleLine({
  sku = "MUA-TOLU-BUN-26",
  quantity = 1,
  inventoryPlan = "1x MUA-HYD-TN-15PK, 1x MUA-HYD-IB-15PK, 1x MUA-HYD-GS-15PK",
  launchExtras = "1x MW-STCKRPACK-1",
  sellingPlan = false,
} = {}) {
  return {
    id: 10,
    sku,
    quantity,
    selling_plan_allocation: sellingPlan ? { selling_plan: { id: 123 } } : null,
    properties: [
      { name: "_bundle_group", value: "bundle-1" },
      { name: "_bundle_primary", value: "true" },
      { name: "_inventory_plan", value: inventoryPlan },
      { name: "_launch_extras", value: launchExtras },
    ],
  };
}

function limaLine(values = {}) {
  return bundleLine({
    sku: "MUA-LIMA-BUN-26",
    inventoryPlan: "2x MUA-HYD-TN-15PK, 1x MUA-HYD-IB-15PK, 2x MUA-HYD-GS-15PK",
    launchExtras: CURRENT_LIMA_EXTRAS,
    ...values,
  });
}

function assertInvalidPlan(order, pattern) {
  assert.throws(
    () => componentPlan(order),
    (error) => error instanceof BundlePlanValidationError && pattern.test(error.message),
  );
}

test("accepts the current one-time Tolu offer", () => {
  const plan = componentPlan(order({ line_items: [bundleLine()] }));
  assert.deepEqual(plan, [
    { sku: "MUA-HYD-TN-15PK", quantity: 1, source: "pouch", group: "bundle-1" },
    { sku: "MUA-HYD-IB-15PK", quantity: 1, source: "pouch", group: "bundle-1" },
    { sku: "MUA-HYD-GS-15PK", quantity: 1, source: "pouch", group: "bundle-1" },
    { sku: "MW-STCKRPACK-1", quantity: 1, source: "gift", group: "bundle-1" },
  ]);
});

test("accepts the current initial-subscription Tolu offer", () => {
  const plan = componentPlan(order({
    tags: ["Subscription", "Subscription First Order"],
    line_items: [bundleLine({
      sellingPlan: true,
      launchExtras: "1x MW-STCKRPACK-1, 1x MW-BTTL-BLACK",
    })],
  }));

  assert.deepEqual(plan.slice(-2), [
    { sku: "MW-STCKRPACK-1", quantity: 1, source: "gift", group: "bundle-1" },
    { sku: "MW-BTTL-BLACK", quantity: 1, source: "gift", group: "bundle-1" },
  ]);
});

test("rejects a stale Tolu frother and shirt gift payload", () => {
  assertInvalidPlan(
    order({
      line_items: [bundleLine({
        launchExtras: "1x MW-STCKRPACK-1, 1x MW-FROTH-1, 1x LW-SSTS-3XL",
      })],
    }),
    /invalid launch extras.*Expected 1x MW-STCKRPACK-1.*LW-SSTS-3XL.*MW-FROTH-1/i,
  );
});

test("rejects an unknown pouch SKU", () => {
  assertInvalidPlan(
    order({
      line_items: [bundleLine({
        inventoryPlan: "2x MUA-HYD-TN-15PK, 1x UNKNOWN-FREE-SKU",
      })],
    }),
    /disallowed pouch SKU.*UNKNOWN-FREE-SKU/i,
  );
});

test("rejects excess pouch quantities", () => {
  assertInvalidPlan(
    order({
      line_items: [bundleLine({
        inventoryPlan: "2x MUA-HYD-TN-15PK, 1x MUA-HYD-IB-15PK, 1x MUA-HYD-GS-15PK",
      })],
    }),
    /requires exactly 3 pouch\(es\); received 4/i,
  );
});

test("rejects excess gift quantities", () => {
  assertInvalidPlan(
    order({ line_items: [bundleLine({ launchExtras: "2x MW-STCKRPACK-1" })] }),
    /invalid launch extras.*Expected 1x MW-STCKRPACK-1.*received 2x MW-STCKRPACK-1/i,
  );
});

test("rejects bundle properties attached to an unrecognized parent SKU", () => {
  assertInvalidPlan(
    order({ line_items: [bundleLine({ sku: "NOT-A-BUNDLE" })] }),
    /Unrecognized bundle parent SKU NOT-A-BUNDLE/i,
  );
});

test("keeps the pre-cutover Tolu offer valid for historical fulfillment", () => {
  const plan = componentPlan(order({
    created_at: PRE_CUTOVER,
    line_items: [bundleLine({
      launchExtras: "1x MW-STCKRPACK-1, 1x MW-FROTH-1, 1x LW-SSTS-3XL",
    })],
  }));

  assert.deepEqual(plan.slice(-3), [
    { sku: "MW-STCKRPACK-1", quantity: 1, source: "gift", group: "bundle-1" },
    { sku: "MW-FROTH-1", quantity: 1, source: "gift", group: "bundle-1" },
    { sku: "LW-SSTS-3XL", quantity: 1, source: "gift", group: "bundle-1" },
  ]);
});

test("applies current Tolu rules at the configured cutoff", () => {
  assertInvalidPlan(
    order({
      created_at: DEFAULT_TOLU_OFFER_CUTOVER_AT,
      line_items: [bundleLine({
        launchExtras: "1x MW-STCKRPACK-1, 1x MW-FROTH-1, 1x LW-SSTS-3XL",
      })],
    }),
    /invalid launch extras/i,
  );
});

test("honors an explicit Tolu offer cutoff override", () => {
  const plan = componentPlan(
    order({
      line_items: [bundleLine({
        launchExtras: "1x MW-STCKRPACK-1, 1x MW-FROTH-1, 1x LW-SSTS-3XL",
      })],
    }),
    { toluOfferCutoverAt: "2026-09-01T00:00:00Z" },
  );

  assert.deepEqual(plan.slice(-3).map((item) => item.sku), [
    "MW-STCKRPACK-1",
    "MW-FROTH-1",
    "LW-SSTS-3XL",
  ]);
});

test("rejects a Tolu order when its creation timestamp is unavailable", () => {
  assertInvalidPlan(
    { line_items: [bundleLine()] },
    /Order creation timestamp is missing or invalid/i,
  );
});

test("accepts the current one-time Lima gifts", () => {
  const plan = componentPlan(order({ line_items: [limaLine()] }));

  assert.deepEqual(plan.slice(-2), [
    { sku: "MW-STCKRPACK-1", quantity: 1, source: "gift", group: "bundle-1" },
    { sku: "MW-FROTH-1", quantity: 1, source: "gift", group: "bundle-1" },
  ]);
});

test("accepts the current initial-subscription Lima bottle gift", () => {
  const plan = componentPlan(order({
    tags: ["Subscription", "Subscription First Order"],
    line_items: [limaLine({
      sellingPlan: true,
      launchExtras: `${CURRENT_LIMA_EXTRAS}, 1x MW-BTTL-BLACK`,
    })],
  }));

  assert.deepEqual(plan.slice(-3).map((item) => item.sku), [
    "MW-STCKRPACK-1",
    "MW-FROTH-1",
    "MW-BTTL-BLACK",
  ]);
});

test("rejects an old preorder Lima cart when the order is placed after cutover", () => {
  assertInvalidPlan(
    order({
      line_items: [limaLine({ launchExtras: LEGACY_LIMA_EXTRAS })],
    }),
    /MUA-LIMA-BUN-26 has invalid launch extras.*LW-SSTS-3XL.*MW-BTTL-BLACK.*MW-TOTBG-1/i,
  );
});

test("keeps a pre-cutover historical Lima preorder plan valid", () => {
  const plan = componentPlan(order({
    created_at: PRE_CUTOVER,
    line_items: [limaLine({ launchExtras: LEGACY_LIMA_EXTRAS })],
  }));

  assert.deepEqual(plan.slice(-5).map((item) => item.sku), [
    "MW-FROTH-1",
    "MW-STCKRPACK-1",
    "MW-TOTBG-1",
    "MW-BTTL-BLACK",
    "LW-SSTS-3XL",
  ]);
});

test("applies current Lima rules at the configured cutoff", () => {
  assertInvalidPlan(
    order({
      created_at: DEFAULT_LIMA_OFFER_CUTOVER_AT,
      line_items: [limaLine({ launchExtras: LEGACY_LIMA_EXTRAS })],
    }),
    /MUA-LIMA-BUN-26 has invalid launch extras/i,
  );
});

test("honors an explicit Lima offer cutoff override", () => {
  const plan = componentPlan(
    order({ line_items: [limaLine({ launchExtras: LEGACY_LIMA_EXTRAS })] }),
    { limaOfferCutoverAt: "2026-09-01T00:00:00Z" },
  );

  assert.deepEqual(plan.slice(-5).map((item) => item.sku), [
    "MW-FROTH-1",
    "MW-STCKRPACK-1",
    "MW-TOTBG-1",
    "MW-BTTL-BLACK",
    "LW-SSTS-3XL",
  ]);
});

test("rejects excess current Lima gift quantities", () => {
  assertInvalidPlan(
    order({ line_items: [limaLine({
      launchExtras: "2x MW-STCKRPACK-1, 1x MW-FROTH-1",
    })] }),
    /MUA-LIMA-BUN-26 has invalid launch extras.*2x MW-STCKRPACK-1/i,
  );
});

test("rejects an unknown current Lima gift SKU", () => {
  assertInvalidPlan(
    order({ line_items: [limaLine({
      launchExtras: `${CURRENT_LIMA_EXTRAS}, 1x UNKNOWN-FREE-SKU`,
    })] }),
    /MUA-LIMA-BUN-26 has invalid launch extras.*UNKNOWN-FREE-SKU/i,
  );
});

test("rejects a Lima order when its creation timestamp is unavailable", () => {
  assertInvalidPlan(
    { line_items: [limaLine()] },
    /Order creation timestamp is missing or invalid/i,
  );
});

test("skips inherited gifts on Recharge recurring orders but validates pouches", () => {
  const plan = componentPlan(order({
    tags: "Subscription Recurring Order, Recharge",
    line_items: [bundleLine({
      inventoryPlan: "3x MUA-HYD-TN-15PK",
      launchExtras: "1x MW-STCKRPACK-1, 1x MW-BTTL-BLACK, 1x LW-SSTS-3XL",
    })],
  }));

  assert.deepEqual(plan, [
    { sku: "MUA-HYD-TN-15PK", quantity: 3, source: "pouch", group: "bundle-1" },
  ]);
});

test("recognizes recurring-order tags supplied as an array", () => {
  const plan = componentPlan(order({
    tags: ["Recharge", " Subscription Recurring Order "],
    line_items: [bundleLine({
      sku: "MUA-TASI-BUN-26",
      inventoryPlan: "1x MUA-HYD-IB-15PK",
      launchExtras: "1x MW-STCKRPACK-1",
    })],
  }));

  assert.deepEqual(plan, [
    { sku: "MUA-HYD-IB-15PK", quantity: 1, source: "pouch", group: "bundle-1" },
  ]);
});
