const test = require("node:test");
const assert = require("node:assert/strict");
const { componentPlan } = require("../lib/bundle-plan");

test("combines repeat pouch SKU quantities and keeps preorder gifts", () => {
  const plan = componentPlan({ line_items: [{ id: 10, properties: [
    { name: "_bundle_group", value: "lima-1" },
    { name: "_inventory_plan", value: JSON.stringify([{ sku: "POUCH-VANILLA", quantity: 1 }, { sku: "POUCH-VANILLA", quantity: 2 }]) },
    { name: "_launch_extras", value: JSON.stringify([{ sku: "SHIRT-M", quantity: 1 }]) },
  ] }] });
  assert.deepEqual(plan, [
    { sku: "POUCH-VANILLA", quantity: 3, source: "pouch", group: "lima-1" },
    { sku: "SHIRT-M", quantity: 1, source: "gift", group: "lima-1" },
  ]);
});

test("reads the readable inventory-plan format used by the storefront theme", () => {
  const plan = componentPlan({ line_items: [{ id: 11, properties: [
    { name: "_bundle_group", value: "tolu-1" },
    { name: "_inventory_plan", value: "2× MUA-HYD-TN-15PK (Tropical Nectar), 1× MUA-HYD-GS-15PK (Golden Sunrise)" },
    { name: "_launch_extras", value: "1× MW-STCKRPACK-1 (Stickers), 1× MW-FROTH-1 (Frother)" },
  ] }] });
  assert.deepEqual(plan, [
    { sku: "MUA-HYD-TN-15PK", quantity: 2, source: "pouch", group: "tolu-1" },
    { sku: "MUA-HYD-GS-15PK", quantity: 1, source: "pouch", group: "tolu-1" },
    { sku: "MW-STCKRPACK-1", quantity: 1, source: "gift", group: "tolu-1" },
    { sku: "MW-FROTH-1", quantity: 1, source: "gift", group: "tolu-1" },
  ]);
});
