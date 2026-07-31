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
